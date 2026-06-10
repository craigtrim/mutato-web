workspace "mutato-web" "Live ontology-driven entity-extraction demo" {

    model {
        visitor = person "Demo visitor" "Anyone trying the live demo at d1417qhlp96qo6.cloudfront.net/mutato/"
        maintainer = person "Maintainer" "Pushes deploys to S3 and Lambda"

        mutatoWeb = softwareSystem "mutato-web" "Live demo SPA plus Lambda that compiles user-edited TTL on-the-fly and runs ontology-driven entity extraction" {
            frontend = container "Frontend SPA" "Three-pane editor: ontology tree, text input, provenance ledger. Serializes edits to TTL." "Vite 5 + React 18"
            extractor = container "mutato-extractor Lambda" "Compiles inline TTL via mutato.api.OntologyParser, LRU caches 20 parsers by SHA-256 of TTL, runs exact + span + hierarchy passes" "Python 3.11 / Docker linux/amd64"
            ontologyBuild = container "Ontology build" "Compiles lotr-mutato.owl into MDA JSON, writes it to three locations" "Python script"
        }

        mutato = softwareSystem "mutato" "Upstream Python entity-extraction library, no LLM in the loop" "External"

        visitor -> mutatoWeb "Edits ontology, submits text, sees highlighted spans" "HTTPS"
        maintainer -> mutatoWeb "Deploys frontend bundle and Lambda image" "aws s3 sync / ECR push"
        mutatoWeb -> mutato "Depends on at build time" "pip install"

        visitor -> frontend "Uses" "HTTPS"
        frontend -> extractor "POST {text, ontology_ttl} or {text, ontology: id}" "HTTPS / JSON"
        ontologyBuild -> frontend "Writes public/data/lotr.json" "filesystem"
        ontologyBuild -> extractor "Bakes lambda/ontologies/lotr.json into image" "filesystem"
        extractor -> mutato "OntologyParser, MutatoAPI" "Python import"
    }

    views {
        systemContext mutatoWeb "Context" {
            include *
            autolayout lr
        }

        container mutatoWeb "Containers" {
            include *
            autolayout lr
        }

        theme default
    }
}
