import re, sys, json
sys.stdout.reconfigure(encoding='utf-8')
p = 'C:/ClaudeCodeProjects/Cairn/_review/2026-07-market-research/final_report_data.js'
c = open(p, 'r', encoding='utf-8', errors='replace').read()

i_start = c.find('"citations": {')
if i_start < 0:
    i_start = c.find('"citations":{')
if i_start < 0:
    print('citations not found'); sys.exit(1)
# Find opening brace
brace_i = c.find('{', i_start)
start_obj = brace_i
i = start_obj + 1
depth = 1
BACKSLASH = chr(92)
QUOTE = chr(34)
while depth > 0 and i < len(c):
    ch = c[i]
    if ch == QUOTE:
        j = i + 1
        while j < len(c):
            if c[j] == BACKSLASH:
                j += 2
                continue
            if c[j] == QUOTE:
                break
            j += 1
        i = j + 1
        continue
    if ch == '{': depth += 1
    elif ch == '}': depth -= 1
    i += 1
end_obj = i
cit_json = c[start_obj:end_obj]

obj = json.loads(cit_json)
print(f'Parsed {len(obj)} citations')
simple = {}
for k, v in obj.items():
    simple[k] = {'raw_quote': v.get('raw_quote', ''), 'language': v.get('language', 'en')}
with open('C:/ClaudeCodeProjects/Cairn/_review/2026-07-market-research/citations_extract.json', 'w', encoding='utf-8') as f:
    json.dump(simple, f, ensure_ascii=False, indent=2)
print('Written')
