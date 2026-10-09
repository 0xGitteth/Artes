"""Offline CPU cost benchmark for a pinned NSFW shadow model.

Only aggregate metrics are printed. Images are local and never uploaded.
Use approved development images only; do not benchmark on prohibited material.
"""
import argparse
import json
import math
import resource
import statistics
import time
from pathlib import Path

from PIL import Image

from nsfw_shadow import classify_nsfw, load_nsfw_model, validate_revision


def percentile(values, percent):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * percent / 100) - 1)]


def collect_images(directory, maximum):
    folder = Path(directory).resolve()
    if not folder.is_dir():
        raise ValueError('images_directory_missing')
    images = [
        path for path in sorted(folder.iterdir())
        if path.is_file() and path.suffix.lower() in {'.jpg', '.jpeg', '.png', '.webp'}
    ]
    return images[:maximum]


def benchmark(files, revision, eur_per_vcpu_hour):
    validate_revision(revision)
    wall_times = []
    cpu_times = []
    fail_count = 0
    start_load = time.perf_counter()
    load_nsfw_model(revision)
    model_load_seconds = time.perf_counter() - start_load

    for path in files:
        try:
            with Image.open(path) as src:
                image = src.convert('RGB')
            start_wall = time.perf_counter()
            start_cpu = time.process_time()
            classify_nsfw(image, revision)
            cpu_seconds = time.process_time() - start_cpu
            wall_seconds = time.perf_counter() - start_wall
            wall_times.append(wall_seconds)
            cpu_times.append(cpu_seconds)
        except Exception:
            fail_count += 1

    peak_rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    mean_cpu = statistics.mean(cpu_times) if cpu_times else None
    return {
        'modelId': 'viddexa/nsfw-detection-2-mini',
        'modelRevision': revision,
        'platform': 'cpu',
        'observedImages': len(files),
        'successfulInferences': len(wall_times),
        'failedInferences': fail_count,
        'modelLoadWallSeconds': round(model_load_seconds, 4),
        'meanInferenceWallMs': round(statistics.mean(wall_times) * 1000, 2) if wall_times else None,
        'p95InferenceWallMs': round(percentile(wall_times, 95) * 1000, 2) if wall_times else None,
        'meanProcessCpuSecondsPerImage': round(mean_cpu, 4) if mean_cpu is not None else None,
        'approxCpuHoursPer1000Images': round(mean_cpu * 1000 / 3600, 4) if mean_cpu is not None else None,
        # ru_maxrss is KiB on Linux, which GitHub Codespaces uses.
        'peakProcessRssMiBOnLinux': round(peak_rss / 1024, 1),
        'estimatedComputeEurosPer1000Images': (
            round(mean_cpu * 1000 / 3600 * eur_per_vcpu_hour, 4)
            if mean_cpu is not None and eur_per_vcpu_hour is not None else None
        ),
        'estimationNotes': 'CPU-only approximation, excludes idle hosting, storage, network, peak traffic, moderation retries, and other detectors.',
    }


def main():
    parser = argparse.ArgumentParser(description='Offline aggregate CPU inference cost benchmark')
    parser.add_argument('--images-dir', required=True)
    parser.add_argument('--model-revision', required=True)
    parser.add_argument('--max-images', type=int, default=100)
    parser.add_argument('--eur-per-vcpu-hour', type=float)
    arguments = parser.parse_args()
    if not 1 <= arguments.max_images <= 500:
        parser.error('max-images must be between 1 and 500')
    if arguments.eur_per_vcpu_hour is not None and (
        not math.isfinite(arguments.eur_per_vcpu_hour) or arguments.eur_per_vcpu_hour < 0
    ):
        parser.error('eur-per-vcpu-hour must be nonnegative')
    files = collect_images(arguments.images_dir, arguments.max_images)
    if not files:
        parser.error('no_images_found_in_supplied_directory')
    print(json.dumps(benchmark(files, arguments.model_revision, arguments.eur_per_vcpu_hour), indent=2))


if __name__ == '__main__':
    main()
