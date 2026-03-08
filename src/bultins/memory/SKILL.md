# bultin.memory

Store, recall, summarize, or forget memories. Your entire response must be ONLY this JSON—nothing else.

## store
{"tool":"bultin_memory","arguments":{"action":"store","content":"<要记的内容>","kind":"auto","scope":"global"}}

## recall
{"tool":"bultin_memory","arguments":{"action":"recall","query":"<搜索词>","limit":8}}

## summary
{"tool":"bultin_memory","arguments":{"action":"summary"}}

## forget
{"tool":"bultin_memory","arguments":{"action":"forget","id":"<memory uuid>"}}

kind: identity|task|knowledge|reference|note|auto. scope: session|project|global.
