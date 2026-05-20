#!/bin/bash
# Build, push, and update the mutato-extractor Lambda.
# Self-contained: no dependency on shared infra scripts in any other repo.
#
# Usage: ./update.sh
#
# What it does:
#   1. Ensures the AWS Lambda Python 3.11 x86_64 base image is locally tagged
#   2. Picks the next semver patch above the latest tag in ECR
#   3. Builds the Docker image for linux/amd64
#   4. Logs into ECR, tags, pushes
#   5. Updates the live Lambda function to point at the new image

set -e

PROFILE=dwc_lambda
REGION=us-west-2
REPO=mutato-extractor-repo
FUNCTION=mutato-extractor
ACCOUNT=210182908261
ECR_HOST="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

# Step 1: cache base image as `lambda-base:3.11-amd64` if not already present.
if ! docker image inspect lambda-base:3.11-amd64 > /dev/null 2>&1; then
    echo "Caching AWS Lambda Python 3.11 x86_64 base image..."
    docker pull public.ecr.aws/lambda/python:3.11-x86_64
    docker tag public.ecr.aws/lambda/python:3.11-x86_64 lambda-base:3.11-amd64
fi

# Step 2: pick the next version.
LATEST=$(aws ecr describe-images --repository-name "$REPO" \
    --profile "$PROFILE" --region "$REGION" \
    --query 'imageDetails[].imageTags[]' --output text 2>/dev/null \
    | tr '\t' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)
if [ -z "$LATEST" ]; then
    VERSION=1.0.0
else
    IFS='.' read -r MAJ MIN PATCH <<< "$LATEST"
    VERSION="$MAJ.$MIN.$((PATCH + 1))"
fi
echo "Latest ECR tag: ${LATEST:-(none)}. Building $VERSION..."

# Step 3: build.
DOCKER_BUILDKIT=0 docker build --platform linux/amd64 -t "mutato-extractor:$VERSION" .

# Step 4: login, tag, push.
aws ecr get-login-password --region "$REGION" --profile "$PROFILE" \
    | docker login --username AWS --password-stdin "$ECR_HOST"
docker tag "mutato-extractor:$VERSION" "$ECR_HOST/$REPO:$VERSION"
docker push "$ECR_HOST/$REPO:$VERSION"

# Step 5: update Lambda.
aws lambda update-function-code \
    --function-name "$FUNCTION" \
    --image-uri "$ECR_HOST/$REPO:$VERSION" \
    --publish \
    --profile "$PROFILE" --region "$REGION"

echo "Deployed $FUNCTION at version $VERSION."
