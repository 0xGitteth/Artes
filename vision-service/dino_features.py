"""One embedding definition shared by offline training and image inference."""
import hashlib
import json
import os


class DinoFeatures:
    def __init__(self, model_id='facebook/dinov2-base', revision='main'):
        import torch
        from transformers import AutoImageProcessor, AutoModel
        self.torch = torch
        torch.set_num_threads(int(os.getenv('ARTES_VISION_CPU_THREADS', '4')))
        self.processor = AutoImageProcessor.from_pretrained(model_id, revision=revision, use_fast=False)
        self.model = AutoModel.from_pretrained(model_id, revision=revision).eval()
        resolved = getattr(self.model.config, '_commit_hash', None)
        if not resolved:
            raise ValueError('backbone_revision_could_not_be_resolved')
        dimension = self.model.config.hidden_size
        if dimension != 768:
            raise ValueError(f'unsupported_embedding_dimension:{dimension}')
        self.definition = {
            'modelId': model_id, 'revision': resolved, 'dimension': dimension,
            'pooling': 'cls_last_hidden_state', 'normalization': 'l2',
            'processorSha256': hashlib.sha256(json.dumps(
                self.processor.to_dict(), sort_keys=True, separators=(',', ':')
            ).encode()).hexdigest(),
        }

    def embed(self, images):
        import numpy as np
        inputs = self.processor(images=images, return_tensors='pt')
        with self.torch.inference_mode():
            output = self.model(**inputs)
            vector = self.torch.nn.functional.normalize(output.last_hidden_state[:, 0, :], p=2, dim=1)
        values = vector.detach().cpu().numpy().astype(np.float64)
        if values.shape != (len(images), 768) or not np.isfinite(values).all():
            raise ValueError('invalid_backbone_embedding')
        return values
