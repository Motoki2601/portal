"""Generate deterministic synthetic RFC MIME inputs, without reading a mailbox."""
import base64
import json
from pathlib import Path
import quopri

TEXT = '【ご注文番号】 FIXTURE-MIME-01\n【ご注文商品】\n・「架空クリーナー 詰替 350ml」\n 合計 2 点 900 円\n'
ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / 'docs/personal-commerce/fixtures/gmail-mime-v1.json'


def leaf(content, charset='utf-8', transfer='8bit', kind='plain', extra=''):
    return f'Content-Type: text/{kind}; charset={charset}\r\nContent-Transfer-Encoding: {transfer}\r\n{extra}\r\n'.encode('ascii') + content


def multipart(parts, kind='alternative', boundary='fixture-boundary'):
    marker = boundary.encode('ascii')
    return f'Content-Type: multipart/{kind}; boundary="{boundary}"\r\n\r\n'.encode() + b''.join(b'--' + marker + b'\r\n' + part + b'\r\n' for part in parts) + b'--' + marker + b'--\r\n'


def build():
    cases = []
    ok = {'status': 'decoded', 'bodyKind': 'plain', 'text': TEXT}
    review = lambda code: {'status': 'needs_review', 'code': code}
    def add(name, data, expected):
        # Header addresses and every order/product value are new synthetic data.
        mail = b'From: fixture@example.invalid\r\nTo: nobody@example.invalid\r\nMIME-Version: 1.0\r\n' + data
        cases.append({'id': name, 'raw': base64.urlsafe_b64encode(mail).decode().rstrip('='), 'expected': expected})
    iso = TEXT.encode('iso-2022-jp')
    plain = leaf(TEXT.encode())
    html = leaf(b'<p>UNTRUSTED HTML DUPLICATE</p>', kind='html')
    add('iso2022-7bit', leaf(iso, 'iso-2022-jp', '7bit'), ok)
    add('iso2022-base64', leaf(base64.encodebytes(iso), 'iso-2022-jp', 'base64'), ok)
    add('utf8-quoted-printable', leaf(quopri.encodestring(TEXT.encode()), transfer='quoted-printable'), ok)
    add('utf8-8bit', plain, ok)
    add('plain-before-html', multipart([plain, html]), ok)
    add('html-before-plain', multipart([html, plain]), ok)
    add('html-only', html, review('HTML_UNVERIFIED'))
    add('broken-utf8', leaf(b'\xff\xfe'), review('DECODE_ERROR'))
    add('unknown-charset', leaf(b'fixture', charset='unknown-fixture-charset'), review('DECODE_ERROR'))
    add('replacement-character', leaf('\ufffd'.encode()), review('DECODE_ERROR'))
    add('broken-base64', leaf(b'@@invalid@@', transfer='base64'), review('DECODE_ERROR'))
    add('broken-quoted-printable', leaf(b'fixture=XY', transfer='quoted-printable'), review('DECODE_ERROR'))
    add('attachment-not-body', multipart([plain, leaf(b'ATTACHMENT MUST NOT APPEAR', extra='Content-Disposition: attachment; filename="fixture.txt"\r\n')], 'mixed'), ok)
    add('duplicate-plain', multipart([plain, plain], 'mixed'), review('AMBIGUOUS_PLAIN_PARTS'))
    add('missing-boundary', b'Content-Type: multipart/mixed; boundary="missing"\r\n\r\nfixture', review('DECODE_ERROR'))
    add('empty-plain-with-html', multipart([leaf(b''), html]), review('EMPTY_PLAIN_BODY'))
    add('unsupported-transfer', leaf(b'fixture', transfer='unknown'), review('DECODE_ERROR'))
    add('missing-charset-nonascii', b'Content-Type: text/plain\r\nContent-Transfer-Encoding: 8bit\r\n\r\n' + TEXT.encode(), review('DECODE_ERROR'))
    add('broken-iso2022', leaf(b'\x1b$B\xff', 'iso-2022-jp', '8bit'), review('DECODE_ERROR'))
    add('nested-alternative', multipart([multipart([html, plain])], 'mixed', 'outer-fixture-boundary'), ok)
    add('duplicate-content-type', b'Content-Type: text/plain; charset=utf-8\r\n' + plain, review('DECODE_ERROR'))
    add('forwarded-message', b'Content-Type: message/rfc822\r\n\r\n' + plain, review('FORWARDED_MESSAGE_UNVERIFIED'))
    cases.append({'id': 'invalid-gmail-base64url', 'raw': '@@fixture@@', 'expected': review('DECODE_ERROR')})
    return {'schemaVersion': 1, 'description': 'Synthetic MIME only. Decoded body is not PII-sanitized and is not AI-ready.', 'cases': cases}


if __name__ == '__main__':
    TARGET.write_text(json.dumps(build(), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
