with open('tests/lib/pdf.test.ts', 'r', encoding='utf-8') as f:
    content = f.read()
old = "    // '·' and the name's parens are WinAnsi-escaped in the stream; assert ASCII fragments\n    expect(pdf).toContain('(Account: 1100 ');\n    expect(pdf).toContain('Accounts Receivable \\(Dental Clinics\\))');\n    expect(pdf).toContain('(As of: 2026-09-28)');\n\n\n  });"
new = "    expect(pdf).not.toContain('Account:');\n    expect(pdf).not.toContain('As of:');\n    expect(pdf).not.toContain('(CLINIC)');\n  });"
if old in content:
    content = content.replace(old, new)
    open('tests/lib/pdf.test.ts', 'w', encoding='utf-8').write(content)
    print('replaced ok')
else:
    print('not found')
