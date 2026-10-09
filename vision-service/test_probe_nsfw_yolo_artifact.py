import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path

from probe_nsfw_yolo_artifact import inspect_archive, preflight


class YoloArchivePreflightTests(unittest.TestCase):
    def create_tar(self, path, members):
        with tarfile.open(path, 'w') as output:
            for name, data, kind in members:
                item = tarfile.TarInfo(name)
                if kind == 'symlink':
                    item.type = tarfile.SYMTYPE
                    item.linkname = '../../escaping'
                    output.addfile(item)
                else:
                    item.size = len(data)
                    output.addfile(item, io.BytesIO(data))

    def test_safe_model_archive_only_inspects_without_extraction(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'publisher.tar'
            self.create_tar(path, [
                ('model/best.onnx', b'model-weight-placeholder', 'file'),
                ('model/classes.yaml', b'names: [safe, sexual_act]', 'file'),
            ])
            result = preflight(Path(directory) / 'research', offline_archive=path)
            self.assertEqual(result['status'], 'inspected_not_executed')
            self.assertEqual(result['extensions']['.onnx'], 1)
            self.assertEqual(result['unsafeArchiveEntries'], [])
            self.assertTrue((Path(directory) / 'research/nsfw-yolo-archive-preflight.json').exists())
            self.assertFalse((Path(directory) / 'research/model/best.onnx').exists())
            self.assertNotIn('privateImage', json.dumps(result))

    def test_blocks_path_traversal_and_symbolic_links(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'bad.tar'
            self.create_tar(archive, [
                ('../../../../sneaky.onnx', b'exploit', 'file'),
                ('model/remote.pt', b'', 'symlink'),
            ])
            report = inspect_archive(archive)
            self.assertEqual(len(report['unsafeArchiveEntries']), 2)
            with self.assertRaisesRegex(ValueError, 'model_artifact_requires_manual_review'):
                preflight(Path(directory) / 'work', offline_archive=archive)
            self.assertFalse((Path(directory) / 'sneaky.onnx').exists())

    def test_rejects_bogus_tar_without_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'bogus.tar'
            archive.write_bytes(b'not a tar archive')
            with self.assertRaisesRegex(ValueError, 'model_archive_invalid_tar'):
                inspect_archive(archive)

    def test_pt_weights_are_only_listed_as_untrusted(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'model.tar'
            self.create_tar(archive, [
                ('best.pt', b'not-actually-valid-weights', 'file'),
                ('infer.py', b'print("this must never run")', 'file'),
            ])
            result = preflight(Path(directory) / 'research', offline_archive=archive)
            self.assertEqual(result['status'], 'inspected_not_executed')
            self.assertIn('best.pt', result['potentiallyExecutableOrPickleFiles'])
            self.assertIn('infer.py', result['potentiallyExecutableOrPickleFiles'])


if __name__ == '__main__':
    unittest.main()
