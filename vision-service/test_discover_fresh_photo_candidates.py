import unittest

from discover_fresh_photo_candidates import candidate_from_result, discover


def item(index, *, creator='artist', title='Modern film portrait', license='cc0',
         photo_url=None, original=None):
    return {
        'id': f'{index:08x}-aaaa-bbbb-cccc-000000000000',
        'title': title,
        'creator': creator,
        'creator_url': 'https://www.flickr.com/photos/' + creator,
        'foreign_landing_url': original or (
            f'https://www.flickr.com/photos/{creator}/{100000 + index}'),
        'url': photo_url or 'https://live.staticflickr.com/1111/12_abcd_b.jpg',
        'license': license,
        'license_version': '1.0',
        'license_url': 'https://creativecommons.org/publicdomain/zero/1.0/',
        'source': 'flickr',
        'category': 'photograph',
        'width': 1400, 'height': 900,
        'tags': [{'name': 'portrait'}],
    }


class FreshPhotoDiscoveryTests(unittest.TestCase):
    def test_requires_public_original_creator_and_valid_photo_license(self):
        self.assertIsNotNone(candidate_from_result(item(1), 'editorial', 'portrait'))
        self.assertIsNone(candidate_from_result(item(1, license='by-nc'), 'editorial', 'portrait'))
        self.assertIsNone(candidate_from_result(
            item(1, original='https://example.com/flickr/stolen'), 'editorial', 'portrait'))
        self.assertIsNone(candidate_from_result(
            item(1, photo_url='https://example.com/user-photo.jpg'), 'editorial', 'portrait'))
        self.assertIsNone(candidate_from_result(
            item(1, creator='artist', title='AI-generated photograph'), 'editorial', 'portrait'))
        self.assertIsNone(candidate_from_result(
            item(1, creator='artist', title='Public Domain Illustration by rawpixel'), 'editorial', 'portrait'))
        self.assertIsNone(candidate_from_result(
            item(1, creator='artist', title='teenager portrait'), 'editorial', 'portrait'))

    def test_only_suggests_scene_without_approving_image_rights_or_age(self):
        candidate = candidate_from_result(item(2), 'implied_art_nude', 'art nude')
        self.assertEqual(candidate['sceneHintNotHumanLabel'], 'implied_art_nude')
        self.assertFalse(candidate['canDownloadOrTrain'])
        self.assertFalse(candidate['independentResearchHoldoutEligible'])
        self.assertIn('not_verified', candidate['status'])
        self.assertNotIn('sexualContext', candidate)

    def test_automated_source_balancing_caps_one_artist(self):
        def mock_fetch(_url):
            rows = [item(i, creator='same_author') for i in range(20)]
            rows += [item(45, creator='other_author')]
            return {'result_count': 21, 'results': rows}
        candidates, summary = discover(mock_fetch, max_total=50)
        self.assertEqual(len(candidates), 4)
        self.assertEqual(summary['uniqueCreators'], 2)
        self.assertEqual(summary['retrievedCandidateMetadata'], 4)
        self.assertFalse(summary['copyrightAgeAndImageReleaseVerified'])
        self.assertFalse(any('candidateId' in str(s) for s in summary['sourceQueries']))

    def test_does_not_hide_failed_sources_as_zero_results(self):
        def mock_fetch(_url):
            raise RuntimeError('simulated network error')
        candidates, report = discover(mock_fetch, max_total=1)
        self.assertEqual(candidates, [])
        self.assertEqual(report['retrievedCandidateMetadata'], 0)
        self.assertTrue(report['sourceQueries'])
        self.assertTrue(all(x['status'] == 'error' for x in report['sourceQueries']))


if __name__ == '__main__':
    unittest.main()
