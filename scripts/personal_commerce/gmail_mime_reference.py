"""Offline acceptance oracle for synthetic MIME fixtures; not runtime/PII code."""
import base64
import binascii
from email import policy
from email.parser import BytesParser
import quopri
import re


class Review(Exception):
    pass


def decode_fixture(raw):
    """Return only a plain body, or a body-free review/error decision."""
    try:
        if not isinstance(raw, str) or not re.fullmatch(r'[A-Za-z0-9_-]+={0,2}', raw):
            raise ValueError('invalid raw')
        if len(raw) > 1_400_000:
            raise Review('RESOURCE_EXHAUSTED')
        data = base64.b64decode(raw.rstrip('=') + '=' * (-len(raw.rstrip('=')) % 4), altchars=b'-_', validate=True)
        if base64.urlsafe_b64encode(data).decode().rstrip('=') != raw.rstrip('='):
            raise ValueError('noncanonical raw')
        if len(data) > 1_048_576:
            raise Review('RESOURCE_EXHAUSTED')
        message = BytesParser(policy=policy.default).parsebytes(data)
        plain, html, visited = [], [], 0

        def visit(part, depth=0):
            nonlocal visited
            visited += 1
            if depth > 16 or visited > 64:
                raise Review('RESOURCE_EXHAUSTED')
            if part.get_content_disposition() == 'attachment':
                return
            if part.defects:
                raise ValueError('malformed MIME')
            if part.get_content_type() == 'message/rfc822':
                raise Review('FORWARDED_MESSAGE_UNVERIFIED')
            if part.is_multipart():
                for child in part.iter_parts():
                    visit(child, depth + 1)
            elif part.get_content_type() == 'text/plain':
                plain.append(part)
            elif part.get_content_type() == 'text/html':
                html.append(part)

        visit(message)
        if len(plain) > 1:
            raise Review('AMBIGUOUS_PLAIN_PARTS')
        if not plain:
            raise Review('HTML_UNVERIFIED' if html else 'NO_TEXT_BODY')
        part = plain[0]
        if len(part.get_all('Content-Transfer-Encoding', [])) > 1 or len(part.get_all('Content-Type', [])) > 1:
            raise ValueError('ambiguous MIME headers')
        transfer = (part.get('Content-Transfer-Encoding') or '7bit').lower().strip()
        if transfer == 'base64':
            encoded = part.get_payload(decode=False).encode('ascii')
            content = base64.b64decode(re.sub(rb'\s+', b'', encoded), validate=True)
        elif transfer == 'quoted-printable':
            encoded = part.get_payload(decode=False).encode('ascii')
            if re.search(rb'=(?![0-9A-Fa-f]{2}|\r?\n)', encoded):
                raise ValueError('invalid quoted-printable')
            content = quopri.decodestring(encoded)
        elif transfer in ('7bit', '8bit', 'binary'):
            encoded = part.get_payload(decode=True)
            if transfer == '7bit' and any(byte > 127 for byte in encoded):
                raise ValueError('invalid 7bit')
            content = encoded
        else:
            raise ValueError('unsupported transfer')
        text = content.decode(part.get_content_charset() or 'ascii', errors='strict')
        if '\ufffd' in text:
            raise ValueError('replacement character')
        text = text.replace('\r\n', '\n').replace('\r', '\n')
        if not text.strip():
            raise Review('EMPTY_PLAIN_BODY')
        return {'status': 'decoded', 'bodyKind': 'plain', 'text': text}
    except Review as error:
        return {'status': 'needs_review', 'code': str(error)}
    except (ValueError, LookupError, UnicodeError, binascii.Error, TypeError):
        return {'status': 'needs_review', 'code': 'DECODE_ERROR'}
