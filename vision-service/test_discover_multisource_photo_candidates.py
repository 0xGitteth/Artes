import json
import unittest
import urllib.error

from discover_multisource_photo_candidates import validate_candidate, search


def sample(idx, source='wordpress', creator='new artist'):
    return {
        'license': 'by', 'category': 'photograph',
        'source': source, 'creator': creator,
        'title': 'Contemporary editorial portrait session',
        'foreign_landing_url': f'https://example.org/gallery/{idx}',
        'url': f'https://cdn.example.org/gallery/{idx}.jpg',
        'width': 1200, 'height': 1400, 'tags': [],
    }


class MultiSourcePhotoDiscoveryTests(unittest.TestCase):
    def test_second_photo_source_is_accepted_without_flickr_requirement(self):
        c, why = validate_candidate(sample(1, 'wordpress'), 'editorial', 'portrait')
        self.assertEqual(why, 'accepted_metadata')
        self.assertEqual(c['source'], 'wordpress')
        self.assertFalse(c['approvedForHoldoutOrTraining'])
        self.assertNotIn('url', c)

    def test_no_fake_licenses_or_age_guarantees(self):
        example = sample(1, 'flickr')
        for fields in [
            {'license': 'by-nc'},
            {'title': 'AI-generated editorial'},
            {'title': 'Teenager portrait'},
            {'url': 'http://cdn.example.org/example.jpg'},
            {'foreign_landing_url': 'https://localhost/file'},
        ]:
            with self.subTest(fields=fields):
                v, _ = validate_candidate({**example, **fields}, 'editorial', 'portrait')
                self.assertIsNone(v)

    def test_multisource_discovery_balances_creators_and_handles_network(self):
        counter = [0]
        def fetch(_url):
            counter[0] += 1
            return {'result_count': 500, 'results': [
                sample(1, 'wordpress', 'artist-one'),
                sample(2, 'flickr', 'artist-two'),
                sample(3, 'wordpress', 'artist-three'),
            ]}
        candidates, report = search(fetch=fetch, limit=30)
        self.assertEqual(len(candidates), 3)
        self.assertEqual(set(report['sources']), {'wordpress', 'flickr'})
        self.assertEqual(report['failedQueries'], 0)
        self.assertEqual(report['imagesDownloaded'], 0)
        self.assertGreater(counter[0], 1)
        self.assertNotIn('imageData', json.dumps(report))

    def test_errors_are_explained_not_silently_zero(self):
        def denied(_url):
            raise urllib.error.HTTPError('https://api.openverse.org', 403, 'Denied', {}, None)
        candidates, report = search(fetch=denied)
        self.assertEqual(candidates, [])
        self.assertEqual(report['status'], 'no_candidates_diagnose_errors_or_filters')
        self.assertGreater(report['failedQueries'], 0)
        self.assertTrue(all(q['httpStatus'] == 403 for q in report['queries']))

    def test_filter_statistics_explain_zero(self):
        def only_painting(_url):
            return {'result_count': 1, 'results': [
                {**sample(1), 'title': 'oil on canvas painting'}]}
        candidates, report = search(fetch=only_painting)
        self.assertEqual(candidates, [])
        self.assertGreater(report['rejectedMetadata']['obvious_unsuitable_or_age_ambiguity'], 0)
        self.assertEqual(report['failedQueries'], 0)


if __name__ == '__main__':
    unittest.main()
