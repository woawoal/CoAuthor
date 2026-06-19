"""마크다운 → PDF (Edge 헤드리스). 표·코드블록 포함, 한국어 폰트.

사용: python scripts/md2pdf.py <입력.md> [출력.pdf]
"""
import sys, os, subprocess, tempfile, pathlib
import markdown

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

CSS = """
@page { size: A4; margin: 16mm 14mm; }
* { box-sizing: border-box; }
body { font-family: 'Malgun Gothic','맑은 고딕',sans-serif; font-size: 11pt;
       line-height: 1.55; color: #1a1a1a; max-width: 100%; }
h1 { font-size: 20pt; border-bottom: 3px solid #5b4ddb; padding-bottom: 6px; }
h2 { font-size: 15pt; margin-top: 22px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
h3 { font-size: 12.5pt; margin-top: 16px; color: #333; }
table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 10pt; }
th,td { border: 1px solid #bbb; padding: 5px 8px; text-align: left; vertical-align: top; }
th { background: #f0eefc; font-weight: 700; }
tr:nth-child(even) td { background: #fafafa; }
code { background: #f3f3f3; padding: 1px 5px; border-radius: 3px; font-size: 9.5pt;
       font-family: 'D2Coding','Consolas',monospace; }
pre { background: #f6f8fa; padding: 10px 12px; border-radius: 6px; overflow-x: auto;
      border: 1px solid #e1e4e8; }
pre code { background: none; padding: 0; }
blockquote { border-left: 4px solid #5b4ddb; margin: 8px 0; padding: 2px 14px; color: #555; background: #f8f7ff; }
hr { border: none; border-top: 1px solid #ddd; margin: 18px 0; }
strong { color: #111; }
"""


def main():
    if len(sys.argv) < 2:
        print("사용: python scripts/md2pdf.py <입력.md> [출력.pdf]")
        return 1
    src = pathlib.Path(sys.argv[1]).resolve()
    out = pathlib.Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else src.with_suffix(".pdf")
    text = src.read_text(encoding="utf-8")
    body = markdown.markdown(
        text, extensions=["tables", "fenced_code", "nl2br", "sane_lists", "toc"]
    )
    html = f"<!doctype html><html lang='ko'><head><meta charset='utf-8'><style>{CSS}</style></head><body>{body}</body></html>"

    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False, encoding="utf-8") as f:
        f.write(html)
        html_path = f.name

    url = pathlib.Path(html_path).as_uri()
    try:
        subprocess.run(
            [EDGE, "--headless", "--disable-gpu", "--no-pdf-header-footer",
             f"--print-to-pdf={out}", url],
            check=True, timeout=120,
        )
    finally:
        try:
            os.unlink(html_path)
        except OSError:
            pass

    if out.exists():
        print(f"OK → {out}  ({out.stat().st_size:,} bytes)")
        return 0
    print("PDF 생성 실패")
    return 1


if __name__ == "__main__":
    sys.exit(main())
