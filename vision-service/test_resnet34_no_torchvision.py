"""Fast and network-free checks for the local standard ResNet34 replacement."""
import importlib.util
import unittest

HAS_TORCH = importlib.util.find_spec('torch') is not None


@unittest.skipUnless(HAS_TORCH, 'CPU torch is optional in GitHub lightweight test runner')
class LocalResNet34Tests(unittest.TestCase):
    def test_classic_resnet34_publisher_key_shapes(self):
        from resnet34_no_torchvision import build_red_desert_resnet34
        model = build_red_desert_resnet34('torchvision', num_classes=11)
        state = model.state_dict()
        expected = {
            'conv1.weight': (64, 3, 7, 7),
            'bn1.running_mean': (64,),
            'layer1.0.conv1.weight': (64, 64, 3, 3),
            'layer2.0.downsample.0.weight': (128, 64, 1, 1),
            'layer3.0.conv1.weight': (256, 128, 3, 3),
            'layer4.2.bn2.running_mean': (512,),
            'fc.weight': (11, 512),
            'fc.bias': (11,),
        }
        for key, dims in expected.items():
            with self.subTest(key=key):
                self.assertEqual(tuple(state[key].shape), dims)
        self.assertFalse(any(k.startswith('0.') for k in state))
        self.assertEqual(len(model.layer1), 3)
        self.assertEqual(len(model.layer2), 4)
        self.assertEqual(len(model.layer3), 6)
        self.assertEqual(len(model.layer4), 3)

    def test_fastai_sequential_publisher_key_shapes(self):
        from resnet34_no_torchvision import build_red_desert_resnet34
        model = build_red_desert_resnet34('fastai_sequential', num_classes=11)
        state = model.state_dict()
        self.assertEqual(tuple(state['0.0.weight'].shape), (64, 3, 7, 7))
        self.assertEqual(tuple(state['0.4.0.conv1.weight'].shape), (64, 64, 3, 3))
        self.assertEqual(tuple(state['1.4.weight'].shape), (512, 1024))
        self.assertEqual(tuple(state['1.7.weight'].shape), (11, 512))
        self.assertNotIn('fc.weight', state)

    def test_forward_both_layouts_on_cpu(self):
        import torch
        from resnet34_no_torchvision import build_red_desert_resnet34
        torch.set_num_threads(1)
        with torch.inference_mode():
            for layout in ('torchvision', 'fastai_sequential'):
                model = build_red_desert_resnet34(layout, num_classes=11).eval()
                output = model(torch.zeros((1, 3, 64, 64)))
                self.assertEqual(tuple(output.shape), (1, 11))
                self.assertTrue(bool(torch.isfinite(output).all()))

    def test_reject_unrecognized_layout(self):
        from resnet34_no_torchvision import build_red_desert_resnet34
        with self.assertRaisesRegex(ValueError, 'unsupported_publisher_resnet_layout'):
            build_red_desert_resnet34('unknown', 11)


if __name__ == '__main__':
    unittest.main()
