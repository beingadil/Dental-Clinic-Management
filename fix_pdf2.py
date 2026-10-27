with open('tests/lib/pdf.test.ts', 'r', encoding='utf-8') as f:
    lines = f.read().splitlines(keepends=True)

new_lines = []
i = 0
while i < len(lines):
    line = lines[i]
    if "assert ASCII fragments" in line:
        # Skip old assertion lines and replace
        new_lines.append("    expect(pdf).not.toContain('Account:');\n")
        new_lines.append("    expect(pdf).not.toContain('As of:');\n")
        new_lines.append("    expect(pdf).not.toContain('(CLINIC)');\n")
        new_lines.append("    expect(pdf).toContain('GENERAL LEDGER');\n")
        i += 1
        # Skip the three expect lines
        while i < len(lines) and 'expect(' in lines[i] and "toContain" in lines[i]:
            i += 1
        # Skip blank lines before closing });
        while i < len(lines) and lines[i].strip() == '':
            i += 1
        # Skip the closing }); of the test if present
        if i < len(lines) and '  });' in lines[i]:
            new_lines.append(lines[i])
            i += 1
        continue
    new_lines.append(line)
    i += 1

with open('tests/lib/pdf.test.ts', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)
print('updated')
