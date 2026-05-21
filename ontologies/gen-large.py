#!/usr/bin/env python3
"""Generate two large mutato OWL ontologies:

  - oilgas-mutato.owl     ~1024 entities (Oil & Gas upstream/midstream/downstream)
  - healthcare-mutato.owl ~8192 entities (Urgent Care provider)

Each entity is hand-seeded with a real domain term (where possible) and
extended with templated variants (region-tagged instances, model numbers,
ICD-style codes) to reach the exact count. The structure mirrors
lotr-mutato.owl: prefixed Turtle with `rdfs:subClassOf`, `skos:altLabel`,
and `:inflection`.

Determinism: every run produces the same output. We sort everything and
use a fixed `random.Random(seed)` for any tie-breaking.

Usage:
    python gen-large.py
"""

from __future__ import annotations

import random
import re
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent

OILGAS_OUT = HERE / "oilgas-mutato.owl"
OILGAS_TARGET = 1024

HEALTHCARE_OUT = HERE / "healthcare-mutato.owl"
HEALTHCARE_TARGET = 8192


# ----------------------- core model -----------------------

@dataclass
class Entity:
    name: str
    kind: str  # 'class' or 'instance'
    label: str
    parent: str | None = None
    alt_labels: list[str] = field(default_factory=list)
    inflections: list[str] = field(default_factory=list)


def ttl_ident(s: str) -> str:
    out = re.sub(r"[^A-Za-z0-9_]", "_", s)
    if out and out[0].isdigit():
        out = "_" + out
    return out


def ttl_string(s: str) -> str:
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def render(entities: list[Entity], *, namespace: str, ontology_node: str,
           ontology_label: str, comment: str) -> str:
    """Emit the entity list as a single Turtle document. Order: ontology
    header, classes (alphabetical), instances (alphabetical)."""
    lines: list[str] = [
        f"# {comment}",
        "",
        f"@prefix : <{namespace}> .",
        "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .",
        "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .",
        "@prefix owl: <http://www.w3.org/2002/07/owl#> .",
        "@prefix skos: <http://www.w3.org/2004/02/skos/core#> .",
        "",
        f":{ontology_node} a owl:Ontology ;",
        f"    rdfs:label {ttl_string(ontology_label)} .",
        "",
    ]

    classes = sorted([e for e in entities if e.kind == "class"],
                     key=lambda e: e.name)
    instances = sorted([e for e in entities if e.kind == "instance"],
                       key=lambda e: e.name)

    for e in classes:
        parts: list[str] = [f":{ttl_ident(e.name)} a owl:Class"]
        if e.parent:
            parts.append(f"rdfs:subClassOf :{ttl_ident(e.parent)}")
        parts.append(f"rdfs:label {ttl_string(e.label)}")
        for a in e.alt_labels:
            parts.append(f"skos:altLabel {ttl_string(a)}")
        for f_ in e.inflections:
            parts.append(f":inflection {ttl_string(f_)}")
        lines.append(" ;\n    ".join(parts) + " .")
        lines.append("")

    for e in instances:
        parent = f":{ttl_ident(e.parent)}" if e.parent else "owl:NamedIndividual"
        parts = [f":{ttl_ident(e.name)} a {parent}"]
        parts.append(f"rdfs:label {ttl_string(e.label)}")
        for a in e.alt_labels:
            parts.append(f"skos:altLabel {ttl_string(a)}")
        lines.append(" ;\n    ".join(parts) + " .")
        lines.append("")

    return "\n".join(lines)


# ----------------------- shared helpers -----------------------

def humanize_camel(s: str) -> str:
    """Convert a CamelCase identifier into a human-readable label.

    Rules (applied in order):
      1. Pre-existing whitespace is preserved. If the source already reads
         like a label ("Christmas Tree"), pass through unchanged.
      2. Insert a space before each uppercase letter that follows a
         lowercase letter or digit ("WorkInjuryVisit" -> "Work Injury Visit").
      3. Insert a space before the last uppercase of a run when the next
         char is lowercase ("EKGProcedure" -> "EKG Procedure"). This keeps
         multi-letter acronyms intact instead of collapsing to "E K G".
      4. Strip a trailing numeric disambiguation suffix like "Burn2" -> "Burn".
         Two classes that need distinct labels should differ semantically,
         not by an arbitrary integer.
    """
    if " " in s:
        return s
    # 4: strip trailing digits used purely for disambiguation.
    base = re.sub(r"\d+$", "", s) or s
    # 3: split runs of uppercase before a lowercase tail. "EKGProcedure"
    # -> "EKG Procedure"; "XRay" -> "X Ray" (not ideal but rare).
    step1 = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1 \2", base)
    # 2: split between lowercase/digit and uppercase. "WorkInjuryVisit"
    # -> "Work Injury Visit".
    step2 = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", step1)
    return step2


def auto_inflection(label: str) -> str | None:
    """Cheap plural for a single-word class label. Skip multi-word labels —
    the surface form 'Drilling Fluid' rarely appears as 'drilling fluids'
    in a way that needs a separate inflection beyond the head noun."""
    if " " in label:
        return None
    lower = label.lower()
    if lower.endswith("s") or lower.endswith("y"):
        if lower.endswith("y") and len(lower) > 2 and lower[-2] not in "aeiou":
            return lower[:-1] + "ies"
        if lower.endswith("s"):
            return None  # already plural-shaped
    if lower.endswith(("x", "z", "ch", "sh")):
        return lower + "es"
    return lower + "s"


# ----------------------- oil & gas -----------------------

OILGAS_NS = "https://craigtrim.com/ontologies/oilgas-mutato#"

# Top-level concept areas. Each is a class with subclasses; some subclasses
# get hand-curated instances and others get templated instances. Counts in
# the comments are approximate targets that the templated fill adjusts to
# hit the global 1024 target.
OILGAS_TOP_LEVEL = [
    ("Asset",           "Asset"),
    ("Equipment",       "Equipment"),
    ("Well",            "Well"),
    ("Hydrocarbon",     "Hydrocarbon"),
    ("Pipeline",        "Pipeline"),
    ("Facility",        "Facility"),
    ("Reservoir",       "Reservoir"),
    ("Operation",       "Operation"),
    ("Personnel",       "Personnel"),
    ("Hazard",          "Hazard"),
    ("Region",          "Region"),
    ("Regulation",      "Regulation"),
]

OILGAS_SUBCLASSES = {
    "Equipment": [
        ("Pump",               ["mud pump", "centrifugal pump", "reciprocating pump"]),
        ("Compressor",         ["gas compressor", "reciprocating compressor"]),
        ("Valve",              ["gate valve", "ball valve", "check valve", "choke valve"]),
        ("Separator",          ["three-phase separator", "knock-out drum"]),
        ("HeatExchanger",      ["shell-and-tube exchanger", "plate exchanger"]),
        ("Tank",               ["storage tank", "surge tank", "frac tank"]),
        ("DrillBit",           ["roller cone bit", "PDC bit", "drag bit"]),
        ("BlowoutPreventer",   ["BOP", "annular preventer", "ram preventer"]),
        ("Christmas Tree",     ["wellhead tree", "subsea tree"]),
        ("Manifold",           ["choke manifold", "kill manifold"]),
        ("Pig",                ["cleaning pig", "smart pig"]),
        ("Skid",               ["compressor skid", "metering skid"]),
        ("DrillingRig",        ["land rig", "jackup rig", "semisub", "drillship"]),
        ("Casing",             []),
        ("Tubing",             ["production tubing", "coil tubing"]),
    ],
    "Well": [
        ("VerticalWell",   []),
        ("HorizontalWell", ["horizontal", "lateral well"]),
        ("DeviatedWell",   ["directional well"]),
        ("SubseaWell",     []),
        ("InjectionWell",  ["water injector", "gas injector"]),
        ("ProductionWell", ["oil producer", "gas producer"]),
        ("ExplorationWell",["wildcat"]),
        ("AppraisalWell",  []),
        ("WorkoverWell",   []),
        ("InfillWell",     []),
    ],
    "Hydrocarbon": [
        ("CrudeOil",       ["crude", "sour crude", "sweet crude"]),
        ("NaturalGas",     ["natgas"]),
        ("LNG",            ["liquefied natural gas"]),
        ("LPG",            ["liquefied petroleum gas", "propane", "butane"]),
        ("Condensate",     ["NGL", "natural gas liquid"]),
        ("Naphtha",        []),
        ("Gasoline",       ["petrol", "motor gasoline"]),
        ("Diesel",         ["gas oil", "automotive diesel"]),
        ("Kerosene",       ["jet fuel", "Jet-A1"]),
        ("FuelOil",        ["bunker", "heavy fuel oil"]),
        ("Asphalt",        ["bitumen"]),
        ("Bitumen",        []),
    ],
    "Pipeline": [
        ("GatheringLine", []),
        ("TrunkLine",     ["transmission line"]),
        ("Flowline",      []),
        ("SubseaPipeline",[]),
        ("Riser",         []),
        ("Umbilical",     []),
    ],
    "Facility": [
        ("Refinery",          []),
        ("GasPlant",          ["gas processing plant"]),
        ("LNGPlant",          []),
        ("CompressorStation", []),
        ("PumpStation",       []),
        ("TankFarm",          ["tank battery"]),
        ("FPSO",              ["floating production storage and offloading"]),
        ("Platform",          ["offshore platform"]),
        ("Terminal",          ["marine terminal", "loading terminal"]),
        ("ProcessingUnit",    ["plant unit", "process unit"]),
    ],
    "Reservoir": [
        ("Sandstone",   []),
        ("Carbonate",   ["limestone reservoir"]),
        ("Shale",       ["unconventional shale"]),
        ("TightOil",    []),
        ("CoalbedMethane",["CBM"]),
        ("Aquifer",     []),
        ("Trap",        ["structural trap", "stratigraphic trap"]),
    ],
    "Operation": [
        ("Drilling",        ["spudding"]),
        ("Completion",      []),
        ("Workover",        ["well workover"]),
        ("Production",      []),
        ("Stimulation",     ["frac job", "fracking", "hydraulic fracturing"]),
        ("Cementing",       []),
        ("LoggingOperation",["wireline logging", "LWD", "MWD"]),
        ("WellTest",        ["DST", "drill stem test"]),
        ("Inspection",      []),
        ("Decommissioning", ["P&A", "plug and abandon"]),
        ("Maintenance",     ["preventive maintenance"]),
    ],
    "Personnel": [
        ("Driller",      []),
        ("ToolPusher",   []),
        ("Roughneck",    []),
        ("Roustabout",   []),
        ("MudLogger",    []),
        ("Geologist",    ["wellsite geologist", "petroleum geologist"]),
        ("Petrophysicist",[]),
        ("ReservoirEngineer",[]),
        ("ProductionEngineer",[]),
        ("HSEManager",   ["safety manager"]),
        ("CompanyMan",   []),
    ],
    "Hazard": [
        ("Blowout",       ["uncontrolled flow"]),
        ("H2SExposure",   ["hydrogen sulfide", "sour gas exposure"]),
        ("Spill",         ["oil spill"]),
        ("Fire",          ["wellhead fire", "platform fire"]),
        ("Explosion",     ["vapor cloud explosion"]),
        ("NORM",          ["naturally occurring radioactive material"]),
        ("Kick",          ["well kick"]),
        ("LossOfContainment",["LOC"]),
    ],
    "Region": [
        ("PermianBasin", ["Permian"]),
        ("EagleFord",    []),
        ("Bakken",       []),
        ("Marcellus",    []),
        ("GulfOfMexico", ["GOM"]),
        ("NorthSea",     []),
        ("MiddleEast",   []),
        ("OffshoreBrazil",[]),
        ("WestAfrica",   []),
        ("Siberia",      []),
        ("PreSalt",      ["pre-salt"]),
    ],
    "Regulation": [
        ("APIStandard", ["API"]),
        ("ISOStandard", ["ISO"]),
        ("OSHARule",    ["OSHA"]),
        ("EPARule",     []),
        ("PHMSA",       []),
    ],
}

OILGAS_INSTANCE_SEEDS = {
    # Subclass -> list of (instance label, [alt labels])
    "Refinery": [
        ("Baytown Refinery", ["ExxonMobil Baytown"]),
        ("Baton Rouge Refinery", []),
        ("Rotterdam Refinery", []),
        ("Jamnagar Refinery", []),
    ],
    "FPSO": [
        ("FPSO Cidade de Itaguaí", []),
        ("FPSO Sepia", []),
    ],
    "Platform": [
        ("Thunder Horse", []),
        ("Troll A", []),
        ("Petronius", []),
    ],
    "PermianBasin": [
        ("Midland Field", ["Midland"]),
        ("Delaware Basin", []),
        ("Spraberry Trend", []),
    ],
    "GulfOfMexico": [
        ("Mars Field", []),
        ("Atlantis Field", []),
        ("Thunder Horse Field", []),
    ],
    "ProductionWell": [
        ("Well-Spindletop-1", ["Spindletop"]),
        ("Well-Ghawar-A", []),
    ],
    "CrudeOil": [
        ("Brent Blend", ["Brent", "Brent crude"]),
        ("WTI", ["West Texas Intermediate"]),
        ("Dubai Crude", ["Dubai"]),
        ("Bonny Light", []),
    ],
    "LNG": [
        ("Qatar LNG", []),
        ("Sabine Pass LNG", []),
    ],
}


def build_oilgas() -> list[Entity]:
    entities: list[Entity] = []
    used_names: set[str] = set()

    def add(e: Entity) -> None:
        if e.name in used_names:
            return
        used_names.add(e.name)
        entities.append(e)

    # Top-level classes.
    for name, label in OILGAS_TOP_LEVEL:
        infl = auto_inflection(label)
        add(Entity(name, "class", label,
                   inflections=[infl] if infl else []))

    # Subclasses with alt labels and inflections. The identifier remains
    # CamelCase (mutato/TTL identifiers must match [A-Za-z_][A-Za-z0-9_]*),
    # but the rdfs:label is humanized so the tree view shows "Blowout
    # Preventer" rather than "BlowoutPreventer".
    for parent, subs in OILGAS_SUBCLASSES.items():
        for sub, alts in subs:
            label = humanize_camel(sub)
            infl = auto_inflection(label)
            add(Entity(ttl_ident(sub), "class", label,
                       parent=parent,
                       alt_labels=list(alts),
                       inflections=[infl] if infl else []))

    # Hand-curated instances.
    for parent, items in OILGAS_INSTANCE_SEEDS.items():
        for label, alts in items:
            name = ttl_ident(label.replace(" ", ""))
            add(Entity(name, "instance", label,
                       parent=parent, alt_labels=list(alts)))

    # Templated instance fill to hit OILGAS_TARGET. We round-robin across
    # the leaf classes that benefit most from a populated instance roster:
    # wells, pipelines, equipment serial numbers, field names.
    leaf_targets = [
        ("ProductionWell",  "Producer",     ["TX", "OK", "NM", "ND", "WY", "LA", "AK"]),
        ("InjectionWell",   "Injector",     ["TX", "OK", "NM", "ND", "WY"]),
        ("HorizontalWell",  "Lateral",      ["TX", "OK", "NM", "ND"]),
        ("Pump",            "MudPump-Unit", ["Rig1", "Rig2", "Rig3", "Rig4"]),
        ("Compressor",      "Compressor-Unit", ["CS1", "CS2", "CS3"]),
        ("Tank",            "TankFarm-T",   ["A", "B", "C", "D"]),
        ("Pipeline",        "Line",         ["NA", "EU", "ASIA"]),
        ("Refinery",        "Refinery-Unit",["FCC", "CDU", "VDU", "HCK"]),
        ("PermianBasin",    "Lease",        ["A", "B", "C", "D", "E"]),
        ("Bakken",          "Pad",          ["N", "S", "E", "W"]),
        ("Marcellus",       "Pad",          ["N", "S", "E", "W"]),
        ("EagleFord",       "Pad",          ["N", "S", "E", "W"]),
        ("NorthSea",        "Block",        ["UK", "NO", "DK"]),
        ("GulfOfMexico",    "Block",        ["WC", "VK", "GC", "MC"]),
    ]
    rng = random.Random(1024)
    counter = 1
    while len(entities) < OILGAS_TARGET:
        parent, base, tags = leaf_targets[counter % len(leaf_targets)]
        tag = tags[(counter // len(leaf_targets)) % len(tags)]
        label = f"{base} {tag}-{counter:04d}"
        name = ttl_ident(label.replace(" ", "_"))
        alt = label.lower()
        add(Entity(name, "instance", label, parent=parent, alt_labels=[alt]))
        counter += 1
        if counter > 50000:
            break  # safety

    # Trim to exact target if we overshot (shouldn't, but guard against it).
    while len(entities) > OILGAS_TARGET:
        # Pop the last templated instance.
        for i in range(len(entities) - 1, -1, -1):
            if entities[i].kind == "instance" and entities[i].name not in used_names_seeded(OILGAS_INSTANCE_SEEDS):
                used_names.discard(entities[i].name)
                entities.pop(i)
                break

    _ = rng  # quiet linters
    return entities


def used_names_seeded(seed_map: dict) -> set[str]:
    out: set[str] = set()
    for items in seed_map.values():
        for label, _ in items:
            out.add(ttl_ident(label.replace(" ", "")))
    return out


# ----------------------- urgent care / healthcare -----------------------

HEALTHCARE_NS = "https://craigtrim.com/ontologies/healthcare-mutato#"

HEALTHCARE_TOP_LEVEL = [
    ("ClinicalConcept",  "Clinical Concept"),
    ("BodySystem",       "Body System"),
    ("BodyPart",         "Body Part"),
    ("Symptom",          "Symptom"),
    ("Sign",             "Sign"),
    ("Condition",        "Condition"),
    ("Procedure",        "Procedure"),
    ("Medication",       "Medication"),
    ("Allergy",          "Allergy"),
    ("DiagnosticTest",   "Diagnostic Test"),
    ("ImagingStudy",     "Imaging Study"),
    ("LabTest",          "Laboratory Test"),
    ("VitalSign",        "Vital Sign"),
    ("MedicalEquipment", "Medical Equipment"),
    ("Personnel",        "Personnel"),
    ("Encounter",        "Encounter"),
    ("Document",         "Document"),
    ("InsuranceConcept", "Insurance Concept"),
    ("Vaccine",          "Vaccine"),
    ("Injury",           "Injury"),
    ("Triage",           "Triage"),
]

HEALTHCARE_SUBCLASSES = {
    "BodySystem": [
        ("CardiovascularSystem",  ["cardiac system", "circulatory system"]),
        ("RespiratorySystem",     ["pulmonary system"]),
        ("Gastrointestinal",      ["GI system", "digestive system"]),
        ("Musculoskeletal",       ["MSK"]),
        ("NervousSystem",         ["CNS", "PNS"]),
        ("IntegumentarySystem",   ["skin system"]),
        ("EndocrineSystem",       []),
        ("Genitourinary",         ["GU system"]),
        ("ImmuneSystem",          []),
        ("LymphaticSystem",       []),
        ("ReproductiveSystem",    []),
        ("HematologicSystem",     ["blood system"]),
        ("Otolaryngology",        ["ENT"]),
        ("Ophthalmologic",        ["eye system"]),
    ],
    "BodyPart": [
        ("Head",     ["cranium"]),
        ("Neck",     []),
        ("Chest",    ["thorax"]),
        ("Abdomen",  ["belly"]),
        ("Pelvis",   []),
        ("Back",     ["spine"]),
        ("Shoulder", []),
        ("Elbow",    []),
        ("Wrist",    []),
        ("Hand",     []),
        ("Finger",   ["thumb", "digit"]),
        ("Hip",      []),
        ("Knee",     []),
        ("Ankle",    []),
        ("Foot",     []),
        ("Eye",      ["ocular"]),
        ("Ear",      ["aural"]),
        ("Nose",     ["nasal"]),
        ("Throat",   ["pharynx"]),
        ("Mouth",    ["oral cavity"]),
    ],
    "Symptom": [
        ("Pain",        ["ache"]),
        ("Fever",       ["pyrexia"]),
        ("Cough",       []),
        ("Headache",    ["cephalalgia"]),
        ("Nausea",      []),
        ("Vomiting",    ["emesis"]),
        ("Diarrhea",    ["loose stool"]),
        ("Fatigue",     ["tiredness"]),
        ("Dizziness",   ["lightheadedness"]),
        ("ShortnessOfBreath", ["SOB", "dyspnea"]),
        ("ChestPain",   ["thoracic pain"]),
        ("AbdominalPain", ["belly pain", "stomach ache"]),
        ("BackPain",    ["lumbago"]),
        ("SoreThroat",  ["pharyngitis pain", "throat pain"]),
        ("NasalCongestion", ["stuffy nose"]),
        ("Rhinorrhea",  ["runny nose"]),
        ("Rash",        ["skin rash"]),
        ("Itching",     ["pruritus"]),
        ("Swelling",    ["edema"]),
        ("Bleeding",    ["hemorrhage"]),
        ("ChestPressure", []),
        ("Palpitation", ["heart fluttering"]),
        ("Wheezing",    []),
        ("Hemoptysis",  ["coughing up blood"]),
        ("Hematemesis", ["vomiting blood"]),
        ("Syncope",     ["fainting"]),
        ("Vertigo",     []),
        ("Tinnitus",    ["ringing in ears"]),
        ("BlurredVision", []),
        ("PhotophobiaSymptom", ["photophobia", "light sensitivity"]),
    ],
    "Sign": [
        ("Tachycardia",        ["fast heart rate"]),
        ("Bradycardia",        ["slow heart rate"]),
        ("Hypertension",       ["high blood pressure", "HTN"]),
        ("Hypotension",        ["low blood pressure"]),
        ("Tachypnea",          ["fast breathing", "rapid breathing"]),
        ("Hypoxia",            ["low oxygen"]),
        ("Cyanosis",           []),
        ("Pallor",             ["paleness"]),
        ("Jaundice",           ["yellowing"]),
        ("Erythema",           ["redness"]),
        ("Lymphadenopathy",    ["swollen lymph nodes"]),
        ("Hepatomegaly",       ["enlarged liver"]),
        ("Splenomegaly",       ["enlarged spleen"]),
    ],
    "Condition": [
        ("UpperRespiratoryInfection", ["URI", "common cold"]),
        ("Pneumonia",            []),
        ("Bronchitis",           []),
        ("Influenza",            ["flu"]),
        ("StrepThroat",          ["streptococcal pharyngitis"]),
        ("SinusInfection",       ["sinusitis"]),
        ("EarInfection",         ["otitis media", "AOM"]),
        ("ConjunctivitisCondition", ["conjunctivitis", "pink eye"]),
        ("Asthma",               ["reactive airway"]),
        ("AsthmaExacerbation",   []),
        ("AllergicReaction",     []),
        ("Anaphylaxis",          []),
        ("AnxietyAttack",        ["panic attack"]),
        ("MigraineCondition",    ["migraine"]),
        ("UTI",                  ["urinary tract infection"]),
        ("Gastroenteritis",      ["stomach flu"]),
        ("FoodPoisoning",        []),
        ("Dehydration",          []),
        ("Concussion",           ["mild TBI"]),
        ("Sprain",               []),
        ("Strain",               []),
        ("Fracture",             ["broken bone"]),
        ("Dislocation",          []),
        ("Laceration",           ["cut"]),
        ("Burn",                 ["thermal burn"]),
        ("SkinAbscess",          ["abscess"]),
        ("Cellulitis",           []),
        ("InsectBite",           []),
        ("AnimalBite",           ["dog bite"]),
        ("ForeignBodyCondition", ["foreign body"]),
        ("HeatExhaustion",       []),
        ("Hypothermia",          []),
        ("DiabeticEmergency",    ["hyperglycemia", "hypoglycemia"]),
        ("Hypoglycemia",         []),
        ("Hyperglycemia",        []),
        ("ChestPainCondition",   []),
        ("Arrhythmia",           ["irregular heartbeat"]),
        ("AtrialFibrillation",   ["AFib"]),
    ],
    "Procedure": [
        ("Suture",              ["stitches"]),
        ("WoundIrrigation",     []),
        ("SplintApplication",   ["splinting"]),
        ("CastApplication",     ["casting"]),
        ("Incision",            ["I&D", "incision and drainage"]),
        ("Cauterization",       []),
        ("Cryotherapy",         ["cold therapy"]),
        ("Nebulization",        ["nebulizer treatment"]),
        ("OxygenAdministration",["O2 therapy"]),
        ("IVInsertion",         ["intravenous line"]),
        ("InjectionProcedure",  ["intramuscular injection", "IM injection"]),
        ("RapidStrepTest",      []),
        ("RapidFluTest",        []),
        ("RapidCovidTest",      []),
        ("EKGProcedure",        ["ECG"]),
        ("UrinalysisProcedure", []),
        ("PulseOximetry",       []),
        ("EarIrrigation",       []),
        ("EyeIrrigation",       []),
        ("ForeignBodyRemoval",  []),
        ("Reduction",           ["closed reduction"]),
        ("Triage",              []),
    ],
    "Medication": [
        ("Acetaminophen",  ["Tylenol", "paracetamol"]),
        ("Ibuprofen",      ["Advil", "Motrin"]),
        ("Naproxen",       ["Aleve"]),
        ("Aspirin",        ["ASA"]),
        ("Amoxicillin",    ["amox"]),
        ("Azithromycin",   ["Z-pack"]),
        ("Cephalexin",     ["Keflex"]),
        ("Doxycycline",    []),
        ("Ciprofloxacin",  ["Cipro"]),
        ("Albuterol",      ["Ventolin", "ProAir"]),
        ("Prednisone",     []),
        ("Dexamethasone",  ["Decadron"]),
        ("Diphenhydramine",["Benadryl"]),
        ("Cetirizine",     ["Zyrtec"]),
        ("Loratadine",     ["Claritin"]),
        ("Epinephrine",    ["adrenaline", "EpiPen"]),
        ("Ondansetron",    ["Zofran"]),
        ("Lidocaine",      []),
        ("TetanusVaccine", ["Td", "Tdap"]),
        ("FlexerilMed",    ["cyclobenzaprine"]),
        ("Hydrocortisone", []),
        ("Mupirocin",      ["Bactroban"]),
    ],
    "Allergy": [
        ("PenicillinAllergy", ["pcn allergy"]),
        ("SulfaAllergy",      []),
        ("LatexAllergy",      []),
        ("PeanutAllergy",     []),
        ("ShellfishAllergy",  []),
        ("BeeStingAllergy",   []),
        ("ContrastAllergy",   ["contrast dye allergy"]),
    ],
    "DiagnosticTest": [
        ("Imaging",       []),
        ("PointOfCareTest", ["POC test"]),
        ("BloodDraw",     ["phlebotomy"]),
    ],
    "ImagingStudy": [
        ("ChestXRay",     ["CXR"]),
        ("AbdominalXRay", []),
        ("ExtremityXRay", []),
        ("CTHead",        ["head CT"]),
        ("CTAbdomen",     ["abdominal CT"]),
        ("Ultrasound",    ["US"]),
        ("MRI",           []),
    ],
    "LabTest": [
        ("CBC",             ["complete blood count"]),
        ("BMP",             ["basic metabolic panel"]),
        ("CMP",             ["comprehensive metabolic panel"]),
        ("Urinalysis",      ["UA"]),
        ("PregnancyTest",   ["hCG"]),
        ("InfluenzaPCR",    []),
        ("StrepCulture",    []),
        ("MonoTest",        ["monospot"]),
        ("Troponin",        []),
        ("DDimer",          []),
        ("Glucose",         ["blood sugar"]),
        ("Creatinine",      []),
        ("BUN",             []),
        ("Lipase",          []),
    ],
    "VitalSign": [
        ("HeartRate",        ["pulse", "HR"]),
        ("BloodPressure",    ["BP"]),
        ("Temperature",      ["temp"]),
        ("RespiratoryRate",  ["RR"]),
        ("OxygenSaturation", ["SpO2", "pulse ox"]),
        ("PainScore",        []),
        ("Weight",           []),
        ("Height",           []),
    ],
    "MedicalEquipment": [
        ("Stethoscope",       []),
        ("Otoscope",          []),
        ("Ophthalmoscope",    []),
        ("BloodPressureCuff", ["sphygmomanometer", "BP cuff"]),
        ("PulseOximeter",     ["pulse ox"]),
        ("Thermometer",       []),
        ("Nebulizer",         []),
        ("OxygenTank",        []),
        ("Suture",            ["suture kit"]),
        ("Splint",            []),
        ("ExamTable",         []),
        ("EKGMachine",        []),
    ],
    "Personnel": [
        ("Physician",            ["doctor", "MD"]),
        ("PhysicianAssistant",   ["PA"]),
        ("NursePractitioner",    ["NP"]),
        ("RegisteredNurse",      ["RN", "nurse"]),
        ("MedicalAssistant",     ["MA"]),
        ("Radiologist",          []),
        ("Phlebotomist",         []),
        ("TriageNurse",          []),
        ("Receptionist",         ["front desk"]),
        ("BillingSpecialist",    []),
    ],
    "Encounter": [
        ("WalkInVisit",     []),
        ("ScheduledVisit",  []),
        ("FollowUpVisit",   ["follow-up"]),
        ("TelemedicineVisit", ["telehealth"]),
        ("WorkInjuryVisit", ["workers comp visit"]),
        ("PhysicalExam",    ["sports physical", "school physical"]),
        ("PreEmploymentExam", []),
        ("DOTExam",         []),
    ],
    "Document": [
        ("DischargeInstructions", []),
        ("WorkExcuseNote",        ["doctor's note"]),
        ("ReferralLetter",        []),
        ("PrescriptionDoc",       ["Rx"]),
        ("VisitSummary",          ["after-visit summary"]),
        ("HIPAAConsent",          []),
        ("ConsentForm",           []),
    ],
    "InsuranceConcept": [
        ("Copay",           []),
        ("Deductible",      []),
        ("Coinsurance",     []),
        ("PriorAuthorization", ["prior auth"]),
        ("EOB",             ["explanation of benefits"]),
        ("Claim",           []),
        ("InNetwork",       []),
        ("OutOfNetwork",    []),
        ("Medicare",        []),
        ("Medicaid",        []),
        ("CommercialPayer", []),
        ("WorkersComp",     ["workers compensation"]),
    ],
    "Vaccine": [
        ("FluVaccine",      ["influenza vaccine"]),
        ("CovidVaccine",    ["COVID-19 vaccine"]),
        ("TdapVaccine",     ["tetanus vaccine"]),
        ("MMRVaccine",      []),
        ("HepatitisAVaccine", []),
        ("HepatitisBVaccine", []),
        ("PneumococcalVaccine", []),
        ("ShinglesVaccine", []),
    ],
    "Injury": [
        ("LacerationInjury",  ["laceration"]),
        ("Abrasion",          ["scrape"]),
        ("Contusion",         ["bruise"]),
        ("Puncture",          ["puncture wound"]),
        ("BurnInjury",        ["burn"]),
        ("FractureInjury",    []),
        ("DislocationInjury", []),
        ("SprainInjury",      []),
        ("StrainInjury",      []),
        ("HeadInjury",        []),
        ("ConcussionInjury",  []),
        ("EyeInjury",         []),
        ("WorkRelatedInjury", []),
        ("SportsInjury",      []),
    ],
    "Triage": [
        ("Level1Emergent",  ["emergent"]),
        ("Level2Urgent",    ["urgent"]),
        ("Level3LessUrgent", []),
        ("Level4NonUrgent", ["non-urgent"]),
        ("Level5Routine",   []),
    ],
}

HEALTHCARE_INSTANCE_SEEDS = {
    "Physician": [
        ("Dr. Smith", []),
        ("Dr. Patel", []),
        ("Dr. Garcia", []),
        ("Dr. Nguyen", []),
    ],
    "RegisteredNurse": [
        ("Nurse Jackson", []),
        ("Nurse Lee", []),
    ],
    "TriageNurse": [
        ("Triage Nurse Davis", []),
    ],
    "FluVaccine": [
        ("Fluzone Quadrivalent", []),
        ("Flublok", []),
        ("Fluarix", []),
    ],
    "CovidVaccine": [
        ("Pfizer COVID-19 Vaccine", ["Comirnaty"]),
        ("Moderna COVID-19 Vaccine", ["Spikevax"]),
    ],
}


def build_healthcare() -> list[Entity]:
    entities: list[Entity] = []
    used_names: set[str] = set()

    def add(e: Entity) -> None:
        if e.name in used_names:
            return
        used_names.add(e.name)
        entities.append(e)

    for name, label in HEALTHCARE_TOP_LEVEL:
        infl = auto_inflection(label) if " " not in label else None
        add(Entity(name, "class", label,
                   inflections=[infl] if infl else []))

    for parent, subs in HEALTHCARE_SUBCLASSES.items():
        for sub, alts in subs:
            label = humanize_camel(sub)
            infl = auto_inflection(label)
            add(Entity(ttl_ident(sub), "class", label,
                       parent=parent,
                       alt_labels=list(alts),
                       inflections=[infl] if infl else []))

    for parent, items in HEALTHCARE_INSTANCE_SEEDS.items():
        for label, alts in items:
            name = ttl_ident(label.replace(" ", "").replace(".", ""))
            add(Entity(name, "instance", label,
                       parent=parent, alt_labels=list(alts)))

    # Templated fill. For an urgent-care domain, the natural templated leaf
    # is an ICD-10-style numbered condition row, a visit code, a medication
    # dose form, or a numbered staff member. We rotate through several
    # parent buckets so the resulting ontology has breadth, not just depth.
    leaf_targets = [
        ("UpperRespiratoryInfection", "URI Case",       ["", ""]),
        ("StrepThroat",     "Strep Case",         [""]),
        ("Influenza",       "Flu Case",           [""]),
        ("EarInfection",    "Otitis Media Case",  [""]),
        ("Asthma",          "Asthma Case",        [""]),
        ("UTI",             "UTI Case",           [""]),
        ("Gastroenteritis", "GE Case",            [""]),
        ("Laceration",      "Laceration Case",    [""]),
        ("Sprain",          "Sprain Case",        [""]),
        ("Burn",            "Burn Case",          [""]),
        ("WalkInVisit",     "Walk-In Visit",      [""]),
        ("FollowUpVisit",   "Follow-Up Visit",    [""]),
        ("WorkInjuryVisit", "Work Injury Visit",  [""]),
        ("PhysicalExam",    "Physical Exam",      [""]),
        ("DOTExam",         "DOT Exam",           [""]),
        ("Acetaminophen",   "Acetaminophen Dose", ["325mg", "500mg", "650mg"]),
        ("Ibuprofen",       "Ibuprofen Dose",     ["200mg", "400mg", "600mg", "800mg"]),
        ("Amoxicillin",     "Amoxicillin Dose",   ["250mg", "500mg", "875mg"]),
        ("Azithromycin",    "Azithromycin Dose",  ["250mg", "500mg"]),
        ("Albuterol",       "Albuterol Inhaler",  ["HFA", "Neb"]),
        ("Prednisone",      "Prednisone Taper",   ["5mg", "10mg", "20mg"]),
        ("Physician",       "Provider",           ["A", "B", "C", "D", "E", "F"]),
        ("RegisteredNurse", "RN",                 ["A", "B", "C", "D"]),
        ("MedicalAssistant","MA",                 ["A", "B", "C", "D"]),
        ("DischargeInstructions", "Discharge Sheet", [""]),
        ("PrescriptionDoc", "Rx",                 [""]),
        ("Copay",           "Copay Tier",         ["A", "B", "C"]),
        ("Claim",           "Claim",              [""]),
        ("FluVaccine",      "Flu Dose",           ["2024-25", "2025-26"]),
        ("CovidVaccine",    "COVID Booster",      ["2024", "2025"]),
        ("ChestXRay",       "CXR Study",          [""]),
        ("CTHead",          "CT Head Study",      [""]),
        ("Ultrasound",      "US Study",           [""]),
        ("Urinalysis",      "UA Sample",          [""]),
        ("CBC",             "CBC Sample",         [""]),
        ("EKGProcedure",    "EKG Study",          [""]),
        ("Suture",          "Suture Set",         ["3-0", "4-0", "5-0"]),
        ("SplintApplication", "Splint Set",       ["Volar", "Ulnar", "Thumb"]),
        ("Triage",          "Triage Encounter",   [""]),
    ]
    counter = 1
    while len(entities) < HEALTHCARE_TARGET:
        parent, base, tags = leaf_targets[counter % len(leaf_targets)]
        tag = tags[(counter // len(leaf_targets)) % len(tags)] if tags else ""
        if tag:
            label = f"{base} {tag} #{counter:05d}"
        else:
            label = f"{base} #{counter:05d}"
        name = ttl_ident(label.replace(" ", "_").replace("#", "n").replace("-", "_"))
        if name in used_names:
            counter += 1
            continue
        alt = label.lower().replace("#", "no.")
        add(Entity(name, "instance", label, parent=parent, alt_labels=[alt]))
        counter += 1
        if counter > 200000:
            break

    while len(entities) > HEALTHCARE_TARGET:
        for i in range(len(entities) - 1, -1, -1):
            if entities[i].kind == "instance":
                used_names.discard(entities[i].name)
                entities.pop(i)
                break

    return entities


# ----------------------- main -----------------------

def main() -> None:
    oilgas = build_oilgas()
    print(f"oilgas: {len(oilgas)} entities "
          f"({sum(1 for e in oilgas if e.kind == 'class')} classes, "
          f"{sum(1 for e in oilgas if e.kind == 'instance')} instances)")
    OILGAS_OUT.write_text(render(
        oilgas,
        namespace=OILGAS_NS,
        ontology_node="OilGasMutatoOntology",
        ontology_label="Oil & Gas Mutato Ontology",
        comment="Generated by gen-large.py. Do not edit by hand; rerun the generator.",
    ))
    print(f"  wrote {OILGAS_OUT.name} ({OILGAS_OUT.stat().st_size} bytes)")

    healthcare = build_healthcare()
    print(f"healthcare: {len(healthcare)} entities "
          f"({sum(1 for e in healthcare if e.kind == 'class')} classes, "
          f"{sum(1 for e in healthcare if e.kind == 'instance')} instances)")
    HEALTHCARE_OUT.write_text(render(
        healthcare,
        namespace=HEALTHCARE_NS,
        ontology_node="UrgentCareMutatoOntology",
        ontology_label="Urgent Care Mutato Ontology",
        comment="Generated by gen-large.py. Do not edit by hand; rerun the generator.",
    ))
    print(f"  wrote {HEALTHCARE_OUT.name} ({HEALTHCARE_OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
