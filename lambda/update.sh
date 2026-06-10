#!/bin/bash
# Build, push, and deploy the cosc-mutato-extractor Lambda to the COSC account.
# Self-contained: no dependency on shared infra scripts in any other repo.
#
# Usage: ./update.sh
#
# What it does:
#   1. Ensures the AWS Lambda Python 3.11 x86_64 base image is locally tagged
#   2. Ensures the ECR repo, its Lambda-pull policy, and the log group exist
#   3. Picks the next semver patch above the latest tag in ECR
#   4. Builds the Docker image for linux/amd64 and pushes it
#   5. Creates the function if absent, otherwise updates its code
#
# COSC migration (issue #175): the function is x86_64 (spaCy 3.8.2 ships no
# aarch64 wheels), so it cannot ride the arm64-only cosc-backend tooling; it
# deploys from here. It uses the shared cosc/cosc-lambda-exec execution role and
# returns wildcard CORS like the other COSC demo backends.

set -e

PROFILE=cosc_lambda
REGION=us-west-2
ACCOUNT=069163481355
REPO=cosc-mutato-extractor
FUNCTION=cosc-mutato-extractor
EXEC_ROLE_ARN="arn:aws:iam::$ACCOUNT:role/cosc/cosc-lambda-exec"
LOG_GROUP="/aws/lambda/$FUNCTION"
MEMORY=2048
TIMEOUT=60
ECR_HOST="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

aws_cosc() { aws --profile "$PROFILE" --region "$REGION" "$@"; }

# Step 1: cache base image as `lambda-base:3.11-amd64` if not already present.
if ! docker image inspect lambda-base:3.11-amd64 > /dev/null 2>&1; then
    echo "Caching AWS Lambda Python 3.11 x86_64 base image..."
    docker pull public.ecr.aws/lambda/python:3.11-x86_64
    docker tag public.ecr.aws/lambda/python:3.11-x86_64 lambda-base:3.11-amd64
fi

# Step 2: ensure ECR repo, its Lambda-pull policy, and the log group exist.
if ! aws_cosc ecr describe-repositories --repository-names "$REPO" >/dev/null 2>&1; then
    echo "Creating ECR repo $REPO..."
    aws_cosc ecr create-repository --repository-name "$REPO" \
        --image-scanning-configuration scanOnPush=true >/dev/null
fi
aws_cosc ecr set-repository-policy --repository-name "$REPO" --policy-text "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LambdaImagePull",
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"],
      "Condition": {
        "StringLike": { "aws:SourceArn": "arn:aws:lambda:$REGION:$ACCOUNT:function:cosc-*" }
      }
    }
  ]
}
JSON
)" >/dev/null
aws_cosc logs create-log-group --log-group-name "$LOG_GROUP" 2>/dev/null || true

# Step 3: pick the next version.
LATEST=$(aws_cosc ecr describe-images --repository-name "$REPO" \
    --query 'imageDetails[].imageTags[]' --output text 2>/dev/null \
    | tr '\t' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)
if [ -z "$LATEST" ]; then
    VERSION=1.0.0
else
    IFS='.' read -r MAJ MIN PATCH <<< "$LATEST"
    VERSION="$MAJ.$MIN.$((PATCH + 1))"
fi
echo "Latest ECR tag: ${LATEST:-(none)}. Building $VERSION..."

# Step 4: build, login, tag, push.
DOCKER_BUILDKIT=0 docker build --platform linux/amd64 -t "mutato-extractor:$VERSION" .
aws_cosc ecr get-login-password | docker login --username AWS --password-stdin "$ECR_HOST"
docker tag "mutato-extractor:$VERSION" "$ECR_HOST/$REPO:$VERSION"
docker push "$ECR_HOST/$REPO:$VERSION"

# Step 5: create the function if absent, else update its code.
IMAGE="$ECR_HOST/$REPO:$VERSION"
if aws_cosc lambda get-function --function-name "$FUNCTION" >/dev/null 2>&1; then
    echo "Updating $FUNCTION code..."
    aws_cosc lambda update-function-code \
        --function-name "$FUNCTION" --image-uri "$IMAGE" --publish >/dev/null
    aws_cosc lambda wait function-updated-v2 --function-name "$FUNCTION"
else
    echo "Creating $FUNCTION..."
    aws_cosc lambda create-function \
        --function-name "$FUNCTION" \
        --package-type Image --code "ImageUri=$IMAGE" \
        --role "$EXEC_ROLE_ARN" --architectures x86_64 \
        --memory-size "$MEMORY" --timeout "$TIMEOUT" >/dev/null
    aws_cosc lambda wait function-active-v2 --function-name "$FUNCTION"
fi

echo "Deployed $FUNCTION at version $VERSION (x86_64, COSC account $ACCOUNT)."
