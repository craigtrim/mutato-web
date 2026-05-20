FROM lambda-base:3.11-amd64

# Install mutato and its NLP runtime dependencies.
# en_core_web_sm is the small spaCy English model mutato uses for tokenization.
# x86_64 (not arm64) because spaCy 3.8.2 only publishes Linux x86_64 wheels;
# mutato pins to that version and the slim Amazon Linux 2 base has no gcc, so
# building spaCy from source on arm64 is not viable.
RUN pip install --no-cache-dir --timeout 300 mutato \
    && python -m spacy download en_core_web_sm

# Bake the pre-compiled ontology dicts into the image so cold starts do not
# need to fetch from S3. Total payload for the three demo ontologies is well
# under 1 MB.
WORKDIR ${LAMBDA_TASK_ROOT}
COPY ontologies ./ontologies
COPY lambda_function.py .

CMD [ "lambda_function.handler" ]
