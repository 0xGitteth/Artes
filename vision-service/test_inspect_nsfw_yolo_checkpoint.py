import hashlib
import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path

from inspect_nsfw_yolo_checkpoint import (
    checkpoint_parts, inspect_existing_checkpoint,
)


class OfflineCheckpointAuditTests(unittest.TestCase):
    def test_detects_complete_tf_style_family_only(self):
        items = ['weights/example.ckpt.meta', 'weights/example.ckpt.index',
                 'weights/example.ckpt.data-00000-of-00001']
        found = checkpoint_parts(items)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]['shardCount'], 1)
        self.assertEqual(checkpoint_parts(items[:2]), [])

    def test_reads_metadata_without_running_or_extracting_model(self):
        with tempfile.TemporaryDirectory() as dirname:
            work = Path(dirname)
            tar_path = work / ('nsfw-yolo-' + 'a'*40 + '.tar')
            with tarfile.open(tar_path, 'w') as bundle:
                for name, contents in [
                    ('weights/checkpoint.meta', b'Conv2D YOLOv8 sexual_act MyModel'),
                    ('weights/checkpoint.index', b'weights/conv2d/kernel'),
                    ('weights/checkpoint.data-00000-of-00001', b'not executed'),
                ]:
                    item = tarfile.TarInfo(name)
                    item.size = len(contents)
                    bundle.addfile(item, io.BytesIO(contents))
            digest = hashlib.sha256(tar_path.read_bytes()).hexdigest()
            (work / 'nsfw-yolo-archive-preflight.json').write_text(json.dumps({
                'publisherRevision': 'a'*40, 'archiveSha256': digest,
                'downloadBytes': tar_path.stat().st_size,
            }))
            report = inspect_existing_checkpoint(work)
            self.assertEqual(report['status'], 'checkpoint_family_found_architecture_unverified')
            self.assertEqual(report['tensorflowStyleCheckpointFamilyCount'], 1)
            evidence = report['checkpointFamilies'][0]['metadataEvidence']['meta']
            self.assertTrue(evidence['claimedClassNamePresent']['sexual_act'])
            self.assertIn('yolov8', evidence['hints'])
            self.assertFalse((work / 'weights/checkpoint.meta').exists())
            self.assertTrue((work / 'nsfw-yolo-checkpoint-inspection.json').is_file())

    def test_rejects_tampered_original_archive(self):
        with tempfile.TemporaryDirectory() as dirname:
            work = Path(dirname)
            archive = work / ('nsfw-yolo-' + 'f'*40 + '.tar')
            archive.write_bytes(b'tampered')
            (work / 'nsfw-yolo-archive-preflight.json').write_text(json.dumps({
                'publisherRevision': 'f'*40,
                'archiveSha256': '0'*64,
                'downloadBytes': 8,
            }))
            with self.assertRaisesRegex(ValueError, 'hash_mismatch'):
                inspect_existing_checkpoint(work)


if __name__ == '__main__':
    unittest.main()
