#!/usr/bin/env python3
"""Compile lotr-mutato.owl into the MDA JSON dict consumed by:

  - the Lambda (../lambda/ontologies/lotr.json)
  - the frontend's left-rail class tree (../frontend/public/data/lotr.json)
  - this directory's canonical artifact (./lotr-mutato.json)

Usage:
    pip install -r requirements.txt
    python mutato-build.py
"""

import json
from pathlib import Path

from mutato.api import OntologyParser


HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent

OWL_PATH = HERE / "lotr-mutato.owl"
NAMESPACE = "https://craigtrim.com/ontologies/lotr-mutato"

LOCAL_JSON = HERE / "lotr-mutato.json"
FRONTEND_JSON = REPO_ROOT / "frontend" / "public" / "data" / "lotr.json"
LAMBDA_JSON = REPO_ROOT / "lambda" / "ontologies" / "lotr.json"


def main() -> None:
    if not OWL_PATH.exists():
        raise FileNotFoundError(f"Source OWL not found: {OWL_PATH}")

    print(f"Compiling {OWL_PATH.name} via OntologyParser...")
    op = OntologyParser(OWL_PATH, namespace=NAMESPACE)
    d_owl = op.to_dict()

    payload = json.dumps(d_owl, indent=2, sort_keys=True)

    for target in (LOCAL_JSON, FRONTEND_JSON, LAMBDA_JSON):
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(payload)
        print(f"  wrote {target.relative_to(REPO_ROOT)}")

    n_labels = len(d_owl.get("labels", {}))
    n_synonyms = len(d_owl.get("synonyms", {}).get("fwd", {}))
    print(f"\nCompiled {n_labels} labels, {n_synonyms} synonym entries.")


if __name__ == "__main__":
    main()
