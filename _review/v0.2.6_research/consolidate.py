import json, sys, os
sys.stdout.reconfigure(encoding='utf-8')

all_results = []
for fn in ['results.json','results_retry.json']:
    with open(fn,'r',encoding='utf-8') as f:
        all_results.extend(json.load(f))

with open('all_raw.md','w',encoding='utf-8') as f:
    for q in all_results:
        refs = q.get('web_references', [])
        if not refs: continue
        f.write("\n\n## QUERY: " + q['query'] + "\n\n")
        for i,r in enumerate(refs):
            title = r.get('title','')
            content = r.get('content','')
            url = r.get('link','')
            date = r.get('publish_date','')
            media = r.get('media','')
            f.write("### [" + str(i+1) + "] " + title + "\n")
            f.write("- URL: " + url + "\n")
            f.write("- Media: " + media + " | Date: " + date + "\n")
            f.write("- Content: " + content[:1800] + "\n\n")

print('Wrote all_raw.md')
print('Size: ' + str(os.path.getsize('all_raw.md')//1024) + ' KB')
