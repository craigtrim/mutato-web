#!/usr/bin/env python3
"""Compile each *-mutato.owl into the MDA JSON dict consumed by:

  - the Lambda (../lambda/ontologies/{id}.json)
  - the frontend's left-rail class tree (../frontend/public/data/{id}.json)
  - this directory's canonical artifact (./{name}.json)

Usage:
    pip install -r requirements.txt
    python mutato-build.py
"""

import json
from pathlib import Path

from mutato.api import OntologyParser


HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent


# (owl filename, frontend/lambda id, namespace)
TARGETS = [
    ("lotr-mutato.owl",       "lotr",
     "https://craigtrim.com/ontologies/lotr-mutato"),
    ("oilgas-mutato.owl",     "oilgas",
     "https://craigtrim.com/ontologies/oilgas-mutato"),
    ("healthcare-mutato.owl", "healthcare",
     "https://craigtrim.com/ontologies/healthcare-mutato"),
]


def compile_one(owl_name: str, ont_id: str, namespace: str) -> None:
    owl_path = HERE / owl_name
    if not owl_path.exists():
        raise FileNotFoundError(f"Source OWL not found: {owl_path}")

    print(f"Compiling {owl_path.name} via OntologyParser...")
    op = OntologyParser(owl_path, namespace=namespace)
    d_owl = op.to_dict()

    payload = json.dumps(d_owl, indent=2, sort_keys=True)

    targets = [
        HERE / f"{owl_path.stem}.json",
        REPO_ROOT / "frontend" / "public" / "data" / f"{ont_id}.json",
        REPO_ROOT / "lambda" / "ontologies" / f"{ont_id}.json",
    ]

    for target in targets:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(payload)
        print(f"  wrote {target.relative_to(REPO_ROOT)}")

    n_labels = len(d_owl.get("labels", {}))
    n_synonyms = len(d_owl.get("synonyms", {}).get("fwd", {}))
    print(f"  {n_labels} labels, {n_synonyms} synonym entries.")


def main() -> None:
    for owl_name, ont_id, namespace in TARGETS:
        compile_one(owl_name, ont_id, namespace)
        print()


if __name__ == "__main__":
    main()
