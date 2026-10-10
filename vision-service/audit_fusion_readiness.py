"""Evidence-only release gate audit of cached development results.

Uses aggregate JSON only. No photos, services, model files, images, API calls or
production code. An apparently perfect development score is NOT a release gate.
"""
import argparse
import json
import math
from pathlib import Path

Z_95_TWO_SIDED = 1.959963984540054
MODEL_KEYS = ("luke_scores", "red_desert_scores", "combined_scores")
THRESHOLD_KEYS = ("threshold_0.1", "threshold_0.25", "threshold_0.5", "threshold_0.75")


def wilson_lower(successes, trials, z=Z_95_TWO_SIDED):
    if not isinstance(successes, int) or not isinstance(trials, int):
        raise ValueError("invalid_binomial_counts")
    if not (0 <= successes <= trials):
        raise ValueError("invalid_binomial_counts")
    if trials == 0:
        return None
    fraction = successes / trials
    denominator = 1 + z * z / trials
    center = (fraction + z * z / (2 * trials)) / denominator
    radius = z * math.sqrt(
        fraction * (1 - fraction) / trials + z * z / (4 * trials * trials)
    ) / denominator
    return round(max(0.0, center - radius), 4)


def validate_counts(point, explicit_total, nonexplicit_total):
    required = (
        "detectedPositives", "missedPositives",
        "incorrectlyFlaggedNegatives", "correctlyPassedNegatives",
        "incorrectlyFlaggedAllowedNudes",
    )
    if any(type(point.get(key)) is not int or point[key] < 0 for key in required):
        raise ValueError("invalid_fusion_operating_point")
    if point["detectedPositives"] + point["missedPositives"] != explicit_total:
        raise ValueError("explicit_count_mismatch")
    if point["incorrectlyFlaggedNegatives"] + point["correctlyPassedNegatives"] != nonexplicit_total:
        raise ValueError("nonexplicit_count_mismatch")
    if point["incorrectlyFlaggedAllowedNudes"] > point["incorrectlyFlaggedNegatives"]:
        raise ValueError("allowed_nude_count_exceeds_false_alarms")


def summarize_point(point):
    tp, fp, misses = (
        point["detectedPositives"],
        point["incorrectlyFlaggedNegatives"],
        point["missedPositives"],
    )
    return {
        "detectedExplicit": tp,
        "missedExplicit": misses,
        "flaggedNonExplicit": fp,
        "flaggedAllowedArtNude": point["incorrectlyFlaggedAllowedNudes"],
        "totalFlaggedForPotentialReview": tp + fp,
        "shareOfFlaggedActuallyExplicit": round(tp / (tp + fp), 4) if tp + fp else None,
        "explicitRecallTwoSided95WilsonLower": wilson_lower(tp, tp + misses),
        "flaggedPrecisionTwoSided95WilsonLower": wilson_lower(tp, tp + fp),
    }


def audit(source):
    if source.get("status") != "supervised_development_comparison_not_release_validation":
        raise ValueError("unexpected_development_study_status")
    if source.get("images") != 375 or source.get("sourceGroups") != 103:
        raise ValueError("wrong_or_mixed_development_cohort")
    labels = source.get("humanLabels", {})
    if labels.get("explicit_act") != 41:
        raise ValueError("unexpected_explicit_act_population")
    explicit = 41
    nonexplicit = source["images"] - explicit
    models = source.get("models", {})
    if set(models) != set(MODEL_KEYS):
        raise ValueError("missing_or_unexpected_candidate")
    breakdown = {}
    for name in MODEL_KEYS:
        axis = models[name]["explicit_act"]
        if axis.get("positiveCount") != explicit or axis.get("negativeCount") != nonexplicit:
            raise ValueError("invalid_model_population")
        points = {}
        for threshold in THRESHOLD_KEYS:
            raw_point = axis[threshold]
            validate_counts(raw_point, explicit, nonexplicit)
            points[threshold] = summarize_point(raw_point)
        breakdown[name] = {
            "rankingAucDevelopment": axis["auc"],
            "averagePrecisionDevelopment": axis["averagePrecision"],
            "operatingPoints": points,
        }
    baseline = source.get("legacyRawLukeDevelopmentOnly", {}).get("originalCutoffCounts", {})
    if baseline.get("explicitDetected") != 41 or baseline.get("nonExplicitFlagged") != 78:
        raise ValueError("unexpected_development_baseline")
    winning = breakdown["combined_scores"]["operatingPoints"]["threshold_0.25"]
    if winning["detectedExplicit"] != 41 or winning["flaggedNonExplicit"] != 57:
        raise ValueError("previously_reported_fusion_counts_changed")
    return {
        "status": "no_release_authority_research_only",
        "sourceSample": {
            "images": 375,
            "sourceGroups": 103,
            "explicitAct": explicit,
            "nonExplicit": nonexplicit,
            "independentUntouchedHoldout": False,
        },
        "researchScreeningComparisons": breakdown,
        "historicalRawLukeCutoff": {
            "detectedExplicit": 41,
            "flaggedNonExplicit": 78,
            "flaggedAllowedArtNude": baseline["allowedNudesFlagged"],
        },
        "illustrativeCombinedAtQuarter": winning,
        "releaseApproval": {
            "approved": False,
            "reason": "not_independently_validated_or_released",
            "currentPolicyRequirements": {
                "modelAndDatasetVersionApproval": True,
                "independentPerClassHeldOutExamplesAtLeast": 100,
                "independentPerClassHeldOutGroupsAtLeast": 20,
                "criticalMisses": 0,
                "perClassPrecisionLowerBoundAtLeast": 0.99,
                "minDetectorLabelConfidenceAtLeast": 0.9,
                "minorUncertaintyAndSensitiveCasesNeedSafeFallback": True,
            },
            "missingEvidence": [
                "Untouched, source-disjoint evaluation with complete per-class denominators",
                "Verified model and dataset release versions, calibrated threshold and 0.99 lower confidence precision per approved class",
                "Independent performance on new styles, art nudes, sexual acts, uncertain and safety-sensitive examples",
                "Real moderation policy audit including SafeSearch, Gemini diagnostics and prior moderator decisions",
                "Deployment authorization and production safeguards",
            ],
        },
        "notes": [
            "Current 375 images were used in earlier research and threshold exploration.",
            "Four source-disjoint folds reduce same-source leakage, not historical research bias.",
            "Precision among review flags is NOT precision of a final prohibited-content verdict.",
            "Wilson lower bounds describe only this reused sample and do not satisfy release approval.",
            "Observed zero misses does not establish a zero future-miss rate.",
            "No production safety gate has been changed.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description="Audit Artes cached contextual detector readiness")
    parser.add_argument("--aggregate", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    raw = json.loads(Path(args.aggregate).read_text(encoding="utf-8"))
    result = audit(raw)
    dst = Path(args.output)
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("Research-only review-load audit:", dst)
    print("No independent holdout: release not approved.")
    for model, report in result["researchScreeningComparisons"].items():
        point = report["operatingPoints"]["threshold_0.25"]
        print(model, "explicit", point["detectedExplicit"], "/ 41;",
              "false review flags", point["flaggedNonExplicit"])


if __name__ == "__main__":
    main()
