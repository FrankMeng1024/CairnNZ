[STARTED T+2026-07-17T00:00:00Z]

Source strategy note: safereddit/redlib mirrors strip post URLs from listing pages (URLs hidden behind JS hover); direct old.reddit.com returns "network policy blocked". Falling back to captured listing data (top-of-page raw bodies + scores) and using webSearch to retrieve top comments for highest-signal posts. Comment counts will therefore be uneven across posts; for posts without comment data, only the OP body is preserved.

---

## POST: I have 8000 days in my dayone and printed it
id: reddit_dayoneapp_01
source_url: https://safereddit.com/r/dayoneapp/top?t=year
captured_at: 2026-07-17T00:00:10Z
author: unknown
score: 124
raw_body: |
  I have more than 8300 entries in my diary (which is roughly 23 years), with 5100 day-to-day strike (14 years straight). Last summer I agreed to print a single copy of it, exported right out of Day One and got 25 books, 500 pages each, 10pt font, a4 format. Was totally shocked when the printing service handed me 4 heavy boxes with the diary. It is trully an unforgettable experience to have your digital diary printed on paper. "can't believe I wrote the whole thing", — I thought, while putting those boxes in my car. Can't believe it all started here — https://igorekmakovsky.com/content/diary-1/

### Comments (top N by score)
[comments unavailable — mirror strips post URLs; see search fallback below]

---

## POST: AI - Stay Away from Journals. This is a straight up violation of everything Day One and will be ruinous downfall.
id: reddit_dayoneapp_02
source_url: https://safereddit.com/r/dayoneapp/top?t=year
captured_at: 2026-07-17T00:00:11Z
author: unknown
score: 95
raw_body: |
  Created a burner account just to post this.

  I've been a Day One user for quite a few years now and it's been one of the safest places for me personally and it's feeling very eerie to these AI features being added. A journal is NOT the place AI has to be added.

  Not now. Maybe in 6-7 years once we reach all the higher ends of mass access quantum safety protocols and encryption.

  Don't get me wrong. I am all for tech evolution and keep up to date - if you knew me, you'd know I'm the most techno optimistic person you'd find. And I work a fair bit in the AI space so I know this for sure - NO. Not a good idea at all.

  No amount of privacy and safeguarding Day One is going to integrate - it's just not safe. Posting some points below on this :

  🔒 AI in Day One = Direct Violation of Its E2EE Architecture

  1. Plaintext Exposure Breaks Day One's Core Guarantee
  - Day One's design: entries encrypted on-device with a key that never leaves your device
  - AI requires runtime decryption + plaintext ingestion into inference pipelines, violating the "only you can read it" model at execution time

  2. Data-in-Use Gap Nullifies AES-GCM-256 Protection
  - Day One uses AES-GCM-256 E2EE during sync, securing data at-rest and in-transit
  - AI introduces a data-in-use vulnerability window, exposing entries to RAM scraping, cache-timing (Prime+Probe), and memory disclosure attacks

  3. On-Device Key Isolation is Undermined by Inference Execution
  - The master encryption key never leaves the device, enforcing strict key isolation
  - AI execution shares the same runtime environment, enabling key-adjacent memory exposure, side-channel leakage, and potential enclave boundary violations

  4. Embedding Pipelines Create Irreversible Data Derivatives
  - Day One stores raw encrypted entries only, with no semantic processing
  - AI converts them into vector embeddings (latent space representations) → vulnerable to embedding inversion & semantic reconstruction attacks

  5. Sync Architecture Was Designed for Encrypted Blobs, Not ML Pipelines
  - Day One servers only handle opaque encrypted blobs they cannot decrypt
  - AI features require pre-processing, tokenization, or cloud inference, breaking the "server blindness" property and introducing data exfiltration paths

  6. Backups & Export Paths Become High-Risk Injection Points
  - Non-E2EE exports (JSON/text backups) already exist as unencrypted surfaces
  - AI integration can hook into these layers, enabling data scraping, pipeline poisoning, and unintended ingestion into model workflows

  7. Metadata + Context Enrichment Amplifies Leakage
  - Day One already stores location, time, device metadata alongside entries
  - AI correlation enables multi-modal inference attacks, reconstructing behavioral timelines, routines, and sensitive life events

  8. Violation of Zero-Access Server Trust Model
  - Day One explicitly guarantees even employees cannot read encrypted journals
  - AI-assisted features (especially cloud-backed) introduce privileged processing layers, breaking the zero-access trust boundary

  9. Expanded Attack Surface Beyond Traditional App Threat Model
  - Original threat model: device compromise or key loss
  - AI introduces new classes:
    - prompt injection into journal context
    - model inversion on stored embeddings
    - cross-session data leakage via caching layers

  10. Architectural Mismatch: Vault vs Compute System
  - Day One is designed as a cryptographic vault (store-only, zero-interpretation system)
  - AI transforms it into a stateful compute system with continuous data interpretation, violating its foundational security principle

  The fundamental pillar of Day One has been security and privacy and if that foundation wobbles - Day One shall crash.

  Nature always fills a vacuum and if Day One does not end these AI features, can easily see someone building a much safer version of Day One.

  Lastly, Team at Day One and Automatic - I get the need to drive up revenue and stay up to date with AI - But if you want to really have something that gives you exponential growth - Go the opposite route of staying away from AI and becoming the safest place on the internet.

  In a world where personal data is being comodotised minute by minute, let Day One become the safest sanctuary and you'll win big. If not, decades of trust will erode and you'll kill your own golden goose for short term gains.

  Thanks, A sincere fan.

### Comments (top N by score)
[comments unavailable — see search fallback below]

---

## POST: If this popup doesn't go away soon, I'm cancelling Dayone. My subscription is the last thing I want to think about when I open my journal
id: reddit_dayoneapp_03
source_url: https://safereddit.com/r/dayoneapp/top?t=year
captured_at: 2026-07-17T00:00:12Z
author: unknown
score: 77
raw_body: |
  I get that everyone wants to shove an LLM into everything, and I'm sure those features are great if you want them.

  I open my journal to journal. Day One is good and reliable, so I pay my subscription and carry on.

  I would much rather tell Codex to convert my whole journal to Obsidian-flavored Markdown and never pay a subscription again than look at this every time I open the app.

### Comments (top N by score)
[comments unavailable]

---

## POST: Leaving Day One after this price hike
id: reddit_dayoneapp_04
source_url: https://safereddit.com/r/dayoneapp/top?t=year
captured_at: 2026-07-17T00:00:13Z
author: unknown
score: 60
raw_body: |
  I'm truly sorry for adding to the chorus of people airing their frustrations here but the recent changes weirdly tipped me over the edge.

  The Daily Chat feature felt a bit strange to me, I tried it once and decided I would leave it alone. It felt odd to have a post generated for me, in 1st person, based on a chat with their AI bot (which isn't as engaging as other LLMs). So that kind of gave me an ick. It's prominence in the Today tab also put me off but, eh, I can ignore that and focus on the Journals or More tab which I realised it would default to whenever I opened the app on my phone.

  What really tipped me over the edge was the price hike. I live in Nigeria and pay in Naira (₦), so, when you guys convert it you'll probably laugh at how cheap it is in your respective currencies. I'd been comfortably paying ₦12,700 per year for Premium since 2023. Before that I was a Plus user. I've been using the app on and off since 2015, moved from Day One Classic, all that.

  With the new Gold tier, which I was placed on, the new yearly subscription is ₦119,900. An 800% price hike is insanity. I don't care how many features it has that I've come to rely on, I'm out. Silver is ₦79,900/year.

  The ₦12,700 was obviously ridiculously cheap compared to what others around the world are paying, but that's kind of been a great thing for those of us living in Nigeria: quite a few apps and services are priced according to the general purchasing power of the country. Apple Music is ₦1,300/month, Netflix is ₦8,500/month for example.

  At the back of my mind I'm asking myself, am I just being cheap? But nah, vibes off.

  So, yeah, sorry again for adding to the pile on but I needed to vent.

### Comments (top N by score)
[comments unavailable]

---

## POST: I'm really unhappy about the AI integration.
id: reddit_dayoneapp_05
source_url: https://safereddit.com/r/dayoneapp/top?t=year
captured_at: 2026-07-17T00:00:14Z
author: unknown
score: 57
raw_body: |
  You can't go anywhere these days without seeing that stupid AI symbol. Talking to an LLM so it can basically write entries for you defeats the entire purpose of journaling. I'm just feeling really discouraged by the enshittification of everything in my life. Back to paper journaling I suppose.

### Comments (top N by score)
[comments unavailable]

---

## POST: I am quitting day one and here is how they can get me back
id: reddit_dayoneapp_06
source_url: https://safereddit.com/r/dayoneapp/top?t=year
captured_at: 2026-07-17T00:00:15Z
author: unknown
score: 52
raw_body: |
  I have used day one for 12 plus years (been a customer since the beginning) and decided to switch to another app moving forward. Day One needs to change significantly to get my money again.

  ## What I dislike lately

  - The app design is just bloated. Too many confusing menus, too many tabs. Simplify the design please!
  - The AI features were automatically turned on. The Day One team needs to read the room. ~~People~~ I dislike AI being on by default and you add it in an app that I consider deeply private.
  - The sketching feature has remained very basic for years. It also doesn't work in dark mode - there is a bug that causes the pen color to be white on white when dark mode is enabled on the iPad.
  - Creating and managing templates is laborious.

  ## What I would like to see

  Are you lost in AI hype and do not know how else to improve your app? There's plenty of ways you can add value. Focus on the user experience and not AI.

  - A truly first class handwriting mode for the iPad. Not a sketch, not a digital whiteboard. I want Goodnotes level handwriting support.
  - Don't shove AI left and right. Build thoughtful assistive intelligence that helps with grammar checks, automated formatting etc. Help the user by reducing work in their existing system. I am not against smart features, but against slop and lack of consent.
  - Remove the Daily Chat feature. Clever idea, but it is tone deaf to implement an AI feature like this in a journaling app. The technical details matter less. It doesn't matter how loudly you claim that the data won't be used to train AI models and that data won't be stored. It doesn't matter. ~~Read the room, nobody asked for this. -~~ – Please let me turn it off completely and tuck it out of my view. (I understand some people like this but I still see it on web and inside the today view - just let me turn it off completely).
  - Borrow features from analog journals. Look at the Daily Grow journal from BaronFig.
  - Improve your keyboard. Make it easy to insert tags and more easily on my phone.

  There are many things you can improve in the app without making it so bloated and filled with AI features.

### Comments (top N by score)
[comments unavailable]

---

## POST: On this day
id: reddit_dayoneapp_07
source_url: https://safereddit.com/r/dayoneapp/top?t=year
captured_at: 2026-07-17T00:00:16Z
author: unknown
score: 40
raw_body: |
  does anyone else think "on this day" should have its own toggle on the bottom? I mean, I use that daily and way more often than I use prompts

### Comments (top N by score)
[comments unavailable]

---

## POST: New Gold and Silver plans
id: reddit_dayoneapp_08
source_url: https://safereddit.com/r/dayoneapp/top?t=year
captured_at: 2026-07-17T00:00:17Z
author: unknown
score: 39
raw_body: |
  Am I loosing it and absolutely not understanding this new silver and gold system for more than yet another cash grab price rise?

  Uk pricing

  So silver is now £49.99 which was raised from the previous £30 or so price before they brought the AI stuff out.

  Now they have removed AI features and raised the prices again to £70! Pounds with a new "Gold" tier?

  I'm not sure what is happening to an app I considered a major part of my life and honestly what got me through Covid loneliness. It just seems like here come endless price rises beyond a fair market value.

  If I'm not understanding something here, please do let me know. That's what it looks to me like

### Comments (top N by score)
[comments unavailable]

---

## POST: Who actually holds the record?
id: reddit_dayoneapp_09
source_url: https://safereddit.com/r/dayoneapp/top?t=year
captured_at: 2026-07-17T00:00:18Z
author: unknown
score: 37
raw_body: |
  According to DayOne, there are a few people going back to 2011 when the app was offered. I started in Oct 2014…on a random day waiting for the bus. Now when that day arrives, it's like a New Years for me…I haven't gone and back entered anything but if I could convert Facebook entries I could have history back to about 2008. But it wouldn't be consistent.

  I've exported and AI data-mined my entries and found interesting things about myself. One of them being that I'm actually pretty sentimental. (Or more so than I thought)

  Opened the DayOne PC app today to look for ideas on cross integration.

### Comments (top N by score)
[comments unavailable]

---

## POST: I love DayOne !
id: reddit_dayoneapp_10
source_url: https://safereddit.com/r/dayoneapp/top?t=year
captured_at: 2026-07-17T00:00:19Z
author: unknown
score: 34
raw_body: |
  Just going through my journals organizing and making sure everything is tagged correctly and what not and just wanted to make a little gratitude post. I love you DayOne and I appreciate you so much 🥹 DayOne is priceless to me and if anything ever happened to it I'd be so upset

### Comments (top N by score)
[comments unavailable]

---

## POST: DayOne to Obsidian
id: reddit_dayoneapp_11
source_url: https://safereddit.com/r/dayoneapp/top?t=year
captured_at: 2026-07-17T00:00:20Z
author: unknown
score: 35
raw_body: |
  It's not that I plan to switch yet, since I'm still on the grandfathered plan, but on the other hand, I want to know that I have options to leave. The time I spend now I can pay DayOne for the rest of my life...

  It started as Dayone2Textbundle to archive just as Textbundle. (See other post). Now I added options to make "plain" Markdown files, and merge days, months, and journals. Also, I added all attributes like title, tags, coordinates to the file.

  That means you can now directly export to Obsidian and stay compatible with plugins like DailyNote, Maps (a function of their bases), and whatever else there is.

  Just as an example for the command to move:

  `./run.py --markdown --merge-day --path-template "YYYY/MM" --merge-journals --obsidian --output ~/Obsidian/Dairy`

  So now I know that I can switch every time I want and sleep better. :) And for those who want to switch now:

  https://github.com/Bastian-Kuhn/dayone2textbundle/tree/main

### Comments (top N by score)
[comments unavailable]

---

## POST: 366 Days Streak
id: reddit_dayoneapp_12
source_url: https://safereddit.com/r/dayoneapp/top?t=year
captured_at: 2026-07-17T00:00:21Z
author: unknown
score: 33
raw_body: |
  I've been using DayOne for more than three years and have been a premium user for the last two. In that I don't enter my day overview on a regular basis, but I've started doing so; at the very least, I've added one or two items every day to see what happened. It's been 360 days and six streaks, and this is my first time completing them.

  What are your regular entries?

  It's just not a journal entry for me; it's more like daily logs of what happened that aren't too detailed. Just a glimpse of every day.

### Comments (top N by score)
[comments unavailable]

---

## POST: Do you actually review your old journal entries, or just keep writing?
id: reddit_dayoneapp_13
source_url: https://safereddit.com/r/dayoneapp/top?t=year
captured_at: 2026-07-17T00:00:22Z
author: unknown
score: 29
raw_body: |
  I've been using Day One for years and love it for writing, but I find myself never actually reviewing old entries or spotting patterns. On This Day is nice but limited.
  Curious if others feel this way or if you've found good workflows for understanding themes/progress in your journal over time?

### Comments (top N by score)
[comments unavailable]

---

## POST: Anyone else getting major keyboard lag on iOS since the latest update?
id: reddit_dayoneapp_14
source_url: https://safereddit.com/r/dayoneapp/top?t=year
captured_at: 2026-07-17T00:00:23Z
author: unknown
score: 29
raw_body: |
  Ever since the last Day One update, the app has been super sluggish for me. Specifically, whenever I try to type an entry in any of my journals, there is a very noticeable keyboard delay.

  I'm currently using an iPhone XR. Is anyone else on mobile (especially iOS) experiencing this? It's making it really frustrating to write anything down. Let me know if it's just me or if anyone has found a temporary fix!

### Comments (top N by score)
[comments unavailable]

---

## POST: Day One on MacBook Neo demo
id: reddit_dayoneapp_15
source_url: https://safereddit.com/r/dayoneapp/top?t=year
captured_at: 2026-07-17T00:00:24Z
author: unknown
score: 25
raw_body: |
  Hello everyone! Whilst I am taking a break from Day One, I still love this app and it's UI. Today I was testing out the MacBook Neo at the Apple Store (even though I do own one, I'm insane) I saw Day One!!!

  PLUS, it came with the journal of _random people?_ There's a whole Day One Demo cinematic universe of a black lady and a National Park-loving man. It's insane the effort they put into the demo journal.

  If anyone wants the demo journal, I can send it to them since I did gladly make myself a copy. Happy journaling!

### Comments (top N by score)
[comments unavailable]

---

## POST: Gold level ad removed from latest release, but the bitter taste remains
id: reddit_dayoneapp_16
source_url: https://safereddit.com/r/dayoneapp/top?t=year
captured_at: 2026-07-17T00:00:25Z
author: unknown
score: 25
raw_body: |
  I just upgraded Day One to Version 2026.12.1 (1763). It removed the "Upgrade to Day One Gold" advertisement. That's great news. I'm on the Silver plan and will never need/want/use AI features. Thank you for listening to feedback.

  However, I'm left with a bitter taste in my mouth on the direction Day One is (and has been) going.

  Before Automattic, Day One was commited to keeping my data private. Now, it feels like they want access. I don't blame them. AI training on people's deepest thoughts would be a gold mine. I don't want Day One users to be their mother lode. Are we one dark pattern or questionable dialog away from breaking end-to-end encryption?

  Before the Gold Level, I would've said, no. But now, I'm less certain. Day One needs to double down on their end-to-end encryption commitment. Make it absolutely clear that user's data will remain, and always remain, private. Give us PROOF like a 3rd party audit. Ensure that any interactions with AI are isolated and do not have access to user data. Even then, I worry.

  Worried enough to try other applications. End-to-end encryption was once rare. Now it's far more common. Apple iCloud with ADP turned on is end-to-end encrypted. Not every country has that option, but if you do, any application that stores data on iCloud is protected. (If ADP is supported in your country, please turn it on.)

  Trying Darium, Diarly, and Everlog. They all lack features compared to Day One (the "gold" standard in digital journaling). I'm leaning toward Diarly. It uses markdown, stores data on iCloud, marks my location, handles media. It's good. But not GREAT. There are some places it could use some improvement. On the plus side, there are recent updates and changes. I have high hopes (and a subscription) that believes it'll keep getting better.

### Comments (top N by score)
[comments unavailable]

---

## POST: Today Tab Yuck!
id: reddit_dayoneapp_17
source_url: https://safereddit.com/r/dayoneapp/top?t=year
captured_at: 2026-07-17T00:00:26Z
author: unknown
score: 25
raw_body: |
  If anyone from the DayOne developer team is here: please, PLEASE make it so you can turn off being dumped into the Today tab by default. Don't want it. Don't like it. Want to be in my entry view by default like before. I should have that choice.

  Nothing wrong with liking the Today tab. Or wanting it as the default. I appreciate developers trying things. What I don't appreciate is not having a choice if I don't care and it interrupts my work flow. I hope that is changed quick, because it irks me every time I'm taken where I don't want to go.

### Comments (top N by score)
[comments unavailable]

---

## POST: What are the notable features of DayOne?
id: reddit_dayoneapp_18
source_url: https://safereddit.com/r/dayoneapp/top?t=year
captured_at: 2026-07-17T00:00:27Z
author: unknown
score: 25
raw_body: |
  Recently I'm planning to shift to Apple Journal from DayOne.

  I'm using DayOne for the past two years but my entries are very less; I log everyday, whatever other things happen. I'm not like the stubborn journal; I just want to use it but I keep on uploading the photos also.

  I'm worried if I move to the Apple Journal I need to pay for the iCloud storage.

  What are the notable features that make me stick to the DayOne journal?

### Comments (top N by score)
[comments unavailable]

---

## POST: Your DayOne journals are not as protected as you would think
id: reddit_dayoneapp_19
source_url: https://safereddit.com/r/dayoneapp/top?t=year
captured_at: 2026-07-17T00:00:28Z
author: unknown
score: 22
raw_body: |
  I don't know why I'm so triggered by that. I guess it's that I all the time thought all data in DayOne was encrypted and learned recently that I was wrong assuming that...

  They write big on the website how your data is protected with passcodes and biometric security, but then all the data is openly, world-readable on your file system. So every user, if you share your Mac, can in theory access your data. It doesn't matter whether he is using the same account as you or he is using a separate account on the Mac.

  And everywhere I found (Day One Forum, Support), they claimed that encryption (to prevent that) would make the app too slow, especially on search; on the other hand, they say that the hard disk would be encrypted anyway, and this is protection for DayOne too. So why is the whole system not slow? Right, hardware acceleration for AES... if they wanted to make the effort to protect your data better, they could do it.

  Just see the benchmark, which I did on my (old) M2 Mac. Speed is not the problem; the speed is faster than every file system access. So your disk would be the bottleneck, not the encryption.

  So the only protection there is, is when your MacBook gets stolen. For the running system, only the sandbox macOS has for apps would protect this directory. But with Terminal, or every app you install from outside the App Store with disk access, could access this directory and just copy it.

  That is not the level of security I would expect for a private journal.

  EDIT:
  With all the scenarios, having sudo or not (which would be needed for other users to have shell access), what about this simple one?

  A young couple shares a MacBook. It's hers, and she uses DayOne and feels safe and trusts it. He is a jealous jerk. In the time he claims to be checking Amazon, he just reads her journal. She will never know because the biometric protection keeps her thinking her pictures and thoughts are secure. Not knowing that it's just the app that is protected and not the data

### Comments (top N by score)
[comments unavailable]

---

## POST: This is why I love digital journaling
id: reddit_dayoneapp_20
source_url: https://safereddit.com/r/dayoneapp/top?t=year
captured_at: 2026-07-17T00:00:29Z
author: unknown
score: 22
raw_body: |
  Last week I exported my entire Day One journal for 2025 (just the text file) and ran it through ChatGPT, mostly out of curiosity.

  None of the conclusions were surprising and I could have (and probably did) come to most of them myself. However, it was nice seeing them written out clearly. It was also nice being able to ask follow-up questions, dig a bit deeper into the patterns, and even read some of the insights out loud to my husband.

  But seeing it all laid out clearly made a few lessons impossible to ignore.

  Read more if interested

  https://spasic.me/posts/what-my-2025-journal-taught-me

### Comments (top N by score)
[comments unavailable]

---

## POST: Using Day One as a "single source of truth" for journaling and memory keeping
id: reddit_dayoneapp_21
source_url: https://safereddit.com/r/dayoneapp/top?t=year
captured_at: 2026-07-17T00:00:30Z
author: unknown
score: 23
raw_body: |
  A recent discussion here about combining paper journals and Day One got me thinking, so I wrote a post about how I bring together digital journaling, paper journals, voice journaling, snippets, photos, messages, and emails into one system.

  I also talk about why I think of Day One as my personal "cartulary": a place where everything eventually ends up.

  Thought I'd share in case anyone else is trying to figure out how to make multiple journaling methods work together (because it took me surprisingly long to get to this one simple solution).

  https://spasic.me/posts/building-a-personal-cartulary

### Comments (top N by score)
[comments unavailable]

---

## POST: Linking Feature like Obsidian
id: reddit_dayoneapp_22
source_url: https://safereddit.com/r/dayoneapp/top?t=year
captured_at: 2026-07-17T00:00:31Z
author: unknown
score: 20
raw_body: |
  I have been using Day One since the pandemic, and I just discovered Obsidian about two days ago. The best feature is the linking of ideas or memories, almost like a brain.

  I don't want to transfer my journaling there, but I hope we could link things here…not just with hashtags, but like Obsidian does. It would be great for entries that are like "this reminds me of…" and so on.

  It would be amazing to link something like, "while I was walking, I smelled something that reminds me of…" and then connect it to a specific journal I wrote many, many years ago.

  It's like Day One could become a place for our inner thoughts, a brain that holds memories that might be connected to each other. Ugh! That would be great!

  Just a random thought and a wish that Day One could have this feature.

### Comments (top N by score)
[comments unavailable]

---

## Capture Notes (Phase 1 subagent, honest disclosure)

**Achieved**:
- 22 posts captured from top-of-year listing (target was 25; the redlib rendered listing showed 22 discrete post cards — 3 "empty" `---` separators appeared in raw output where posts had no text body or were image-only with no visible OP; those posts are effectively absent from the listing render, not skipped by me)
- All raw bodies preserved verbatim, no summarization/translation/filtering
- Scores recorded exactly as displayed
- Multiple mirrors cross-validated (safereddit.com, redlib.catsarch.com, red.artemislena.eu all returned identical listings with minor upvote-count drift ±2)

**Not achieved (transparent about failure mode)**:
- Comment threads for all 22 posts are unavailable. Root cause:
  1. All 4 redlib mirrors render post cards as HTML with URLs hidden behind JS hover (webReader extraction cannot see them)
  2. old.reddit.com returns "network policy blocked" (403) to webReader
  3. webSearchStd (ZhipuAI GLM index) does not have r/dayoneapp threads indexed — searches returned unrelated Chinese-language pages
  4. Individual post detail URLs would require post IDs that the listing pages redact
- Author usernames are all "unknown" — same root cause (redlib obscures usernames in listing view to prevent scraping)

**Signal preserved despite missing comments**:
The 22 OP bodies are themselves high-signal for Cairn — they include verbatim rants about AI intrusion (posts 02, 03, 05, 06, 16), price hike anger (04, 08), export/lock-in fear (11), privacy failure (19), review-workflow gaps (13, 22), streak psychology (12), and physical journal integration (01). These are Day One user pain points expressed in first-person — exactly what Cairn's market research needs. Comment threads would deepen but not fundamentally change the pattern already visible.

[COMPLETE T+2026-07-17T00:15:00Z, 22 posts done, 0 comments captured, tool_call_used 11/12]
