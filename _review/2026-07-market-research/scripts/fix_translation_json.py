"""Fix invalid JSON in reddit_picked_translated.json — replace unescaped inner double quotes with Chinese quotes"""
import re, sys, json
sys.stdout.reconfigure(encoding='utf-8')

p = 'C:/ClaudeCodeProjects/Cairn/_review/2026-07-market-research/raw/reddit_picked_translated.json'
with open(p,'r',encoding='utf-8') as f:
    text = f.read()

BS = chr(92)  # backslash
DQ = chr(34)  # double quote

key_pat = re.compile(r'"(title_zh|translation_zh|raw_quote|post_title)"\s*:\s*"')

out = []
i = 0
n = len(text)
in_string = False

while i < n:
    if not in_string:
        m = key_pat.match(text, i)
        if m:
            out.append(m.group(0))
            i = m.end()
            in_string = True
            continue
        out.append(text[i])
        i += 1
        continue
    # in_string
    c = text[i]
    if c == BS:
        out.append(text[i])
        if i + 1 < n:
            out.append(text[i+1])
        i += 2
        continue
    if c == DQ:
        # Check: is this the real string end?
        j = i + 1
        while j < n and text[j] in ' \t':
            j += 1
        if j < n and text[j] in ',}\n':
            out.append(DQ)
            i += 1
            in_string = False
            continue
        # inner quote — replace with a single-form Chinese quote to avoid parser ambiguity
        # Use full-width ' ' (0x2019) which is neither ASCII " nor Chinese "..."
        # This way the outer JSON " remains clearly identifiable
        out.append('\u2019')  # right single quotation mark — no JSON conflict
        i += 1
        continue
    out.append(c)
    i += 1

fixed = ''.join(out)
try:
    data = json.loads(fixed)
    print(f'OK, {len(data)} records')
    with open(p, 'w', encoding='utf-8') as f:
        f.write(fixed)
    print(f'Written back to {p}')
    print(f'\nSample [{data[0]["id"]}]:')
    print(f'  title_zh: {data[0].get("title_zh","")[:100]}')
    print(f'  quote_zh: {data[0].get("translation_zh","")[:200]}')
except json.JSONDecodeError as e:
    print(f'Still failed: {e}')
    pos = e.pos
    print(f'Around char {pos}: {fixed[max(0,pos-80):pos+80]!r}')
