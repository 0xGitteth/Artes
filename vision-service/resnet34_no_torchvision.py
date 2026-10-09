"""Pure PyTorch ResNet34 matching torchvision's official state_dict key layout.

Purpose: run a verified, research-only RedDesert checkpoint in the owner's
existing Codespace without installing torchvision or executing publisher code.

Based on the public ResNet34/BasicBlock architecture and module naming.
Build is lazy so static unit tests run in CI even without torch installed.
"""


def build_resnet34(num_classes=1000):
    import torch
    from torch import nn

    def conv3x3(inplanes, planes, stride=1):
        return nn.Conv2d(inplanes, planes, kernel_size=3, stride=stride,
                         padding=1, bias=False)

    class BasicBlock(nn.Module):
        expansion = 1

        def __init__(self, inplanes, planes, stride=1, downsample=None):
            super().__init__()
            self.conv1 = conv3x3(inplanes, planes, stride)
            self.bn1 = nn.BatchNorm2d(planes)
            self.relu = nn.ReLU(inplace=True)
            self.conv2 = conv3x3(planes, planes)
            self.bn2 = nn.BatchNorm2d(planes)
            self.downsample = downsample
            self.stride = stride

        def forward(self, x):
            identity = x
            out = self.conv1(x)
            out = self.bn1(out)
            out = self.relu(out)
            out = self.conv2(out)
            out = self.bn2(out)
            if self.downsample is not None:
                identity = self.downsample(x)
            out += identity
            return self.relu(out)

    class ResNet34(nn.Module):
        def __init__(self, class_count):
            super().__init__()
            self.inplanes = 64
            self.conv1 = nn.Conv2d(3, 64, kernel_size=7, stride=2,
                                   padding=3, bias=False)
            self.bn1 = nn.BatchNorm2d(64)
            self.relu = nn.ReLU(inplace=True)
            self.maxpool = nn.MaxPool2d(kernel_size=3, stride=2, padding=1)
            self.layer1 = self._make_layer(64, 3)
            self.layer2 = self._make_layer(128, 4, stride=2)
            self.layer3 = self._make_layer(256, 6, stride=2)
            self.layer4 = self._make_layer(512, 3, stride=2)
            self.avgpool = nn.AdaptiveAvgPool2d((1, 1))
            self.fc = nn.Linear(512, class_count)

        def _make_layer(self, planes, count, stride=1):
            downsample = None
            if stride != 1 or self.inplanes != planes:
                downsample = nn.Sequential(
                    nn.Conv2d(self.inplanes, planes, kernel_size=1,
                              stride=stride, bias=False),
                    nn.BatchNorm2d(planes),
                )
            layers = [BasicBlock(self.inplanes, planes, stride, downsample)]
            self.inplanes = planes
            layers += [BasicBlock(self.inplanes, planes) for _ in range(1, count)]
            return nn.Sequential(*layers)

        def forward(self, x):
            x = self.conv1(x)
            x = self.bn1(x)
            x = self.relu(x)
            x = self.maxpool(x)
            x = self.layer1(x)
            x = self.layer2(x)
            x = self.layer3(x)
            x = self.layer4(x)
            x = self.avgpool(x)
            return self.fc(torch.flatten(x, 1))

    return ResNet34(num_classes)


def build_red_desert_resnet34(layout, num_classes=11):
    """Construct the two *publisher-documented* state_dict layouts."""
    if layout not in ('torchvision', 'fastai_sequential'):
        raise ValueError('unsupported_publisher_resnet_layout')
    if not isinstance(num_classes, int) or not (1 <= num_classes <= 1000):
        raise ValueError('invalid_publisher_model_class_count')
    if layout == 'torchvision':
        return build_resnet34(num_classes)

    import torch
    from torch import nn

    class AdaptiveConcatPool2d(nn.Module):
        def __init__(self):
            super().__init__()
            self.ap = nn.AdaptiveAvgPool2d(1)
            self.mp = nn.AdaptiveMaxPool2d(1)

        def forward(self, x):
            return torch.cat([self.mp(x), self.ap(x)], dim=1)

    base = build_resnet34()
    backbone = nn.Sequential(*list(base.children())[:-2])
    head = nn.Sequential(
        AdaptiveConcatPool2d(),
        nn.Flatten(start_dim=1, end_dim=-1),
        nn.BatchNorm1d(1024),
        nn.Dropout(p=0.25),
        nn.Linear(1024, 512, bias=True),
        nn.ReLU(),
        nn.BatchNorm1d(512),
        nn.Dropout(p=0.5),
        nn.Linear(512, num_classes, bias=True),
    )
    return nn.Sequential(backbone, head)
