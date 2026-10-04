---
"@convoso/ai-agent": patch
---

Send the call's disconnect when the page is hidden for good (`pagehide`, e.g. the tab is closed), so a call ends at once instead of after the connection timeout. A later End Call after the page was hidden sends nothing extra. (VOSO-991)
