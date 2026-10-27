with open('tests/lib/pdf.test.ts', 'r', encoding='utf-8') as f:
    content = f.read()

old = "renders canonical account label + code, and an As-of line for all-time periods"
new = "renders clean portrait with no amount headers or clinic column"
content = content.replace(old, new)

# Replace the assertion block
old_block = """    // '·' and the name's parens are WinAnsi-escaped in the stream; assert ASCII fragments
    expect(pdf).toContain('(Account: 1100 ');
    expect(pdf).toContain('Accounts Receivable \\(Dental Clinics\\))');
    expect(pdf).toContain('(As of: 2026-09-28)');"""
new_block = """    // Clean portrait: no amount headers, no CLINIC column.
    expect(pdf).not.toContain('Account:');
    expect(pdf).not.toContain('As of:');
    expect(pdf).not.toContain('(CLINIC)');"""
content = content.replace(old_block, new_block)

# Remove dated sub-test lines
old_dated = """    // Dated periods must NOT get an As-of line
    const dated = buildLedgerPdf(entries.slice(0, 2), {
      ...meta,
      accountName: 'Accounts Receivable (Dental Clinics)',
      accountCode: '1100',
    });
    expect(dated.pdf).not.toContain('(As of:');"""
content = content.replace(old_dated, "")

# Also fix the defaults test to match clean PDF
old_def = "    expect(pdf).toContain('(Account: Accounts Receivable)');"
content = content.replace(old_def, "    expect(pdf).not.toContain('Account:');")
old_def2 = "    expect(pdf).not.toContain('1100 ·');"
content = content.replace(old_def2, "    expect(pdf).not.toContain('1100');")

with open('tests/lib/pdf.test.ts', 'w', encoding='utf-8') as f:
    f.write(content)
print('done')
