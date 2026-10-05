import json
from pathlib import Path
import unittest

from build_gmail_mime_fixtures import build, TARGET
from gmail_mime_reference import decode_fixture


class MimeAcceptance(unittest.TestCase):
    def test_fixtures_match_expected_decisions(self):
        data = json.loads(TARGET.read_text(encoding='utf-8'))
        self.assertEqual(len(data['cases']), 23)
        for case in data['cases']:
            with self.subTest(case=case['id']):
                self.assertEqual(decode_fixture(case['raw']), case['expected'])

    def test_corpus_is_reproducible_without_network_or_mailbox(self):
        self.assertEqual(json.loads(TARGET.read_text(encoding='utf-8')), build())

    def test_errors_do_not_return_headers_payload_or_text(self):
        for raw in [None, '', '@@private@@', 'A', 'A' * 1_400_001]:
            result = decode_fixture(raw)
            self.assertEqual(result['status'], 'needs_review')
            self.assertEqual(set(result), {'status', 'code'})


if __name__ == '__main__':
    unittest.main()
