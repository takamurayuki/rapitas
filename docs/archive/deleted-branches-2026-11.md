# Deleted remote branches — 2026-11-03

Removed in the #1403 cleanup: 536 remote branches had piled up because
"delete branch on merge" was off. Branches whose PR merged are not listed —
their content is in `develop`. The unmerged ones below are listed with their
tip commit so any of them can be restored while GitHub still holds the commit:

```
git push origin <sha>:refs/heads/<branch>
```

| branch | tip commit | reason |
|---|---|---|
| bugfix/agent-routing-and-session-cost | 91e87ab82ecb2ea78c55899547d8213c8ebf2d91 | PR closed unmerged |
| bugfix/bug-error-gh-command-failed-gh-pr-merge-t508 | a1d7733f098bd0512d3b4a262f6dac3df0e570be | PR closed unmerged |
| bugfix/bug-fatal-unhandled-rejection-t507 | b2f391eb7b0060b512dd4ada64de2c6a6430c4a6 | PR closed unmerged |
| bugfix/bug-fatal-unhandled-rejection-t507-1940cf43 | 1940cf4388cdf54df73fbf7c91658b5b0ab0eb8f | PR closed unmerged |
| bugfix/bug-fatal-unhandled-rejection-t507-4332feee | 4332feeef5666d6019b0d61c9a86b24f67e7e0ee | PR closed unmerged |
| bugfix/false-failure-signals | d50ffe32afc5faba104287f29136a8ba2dc1ebb3 | PR closed unmerged |
| bugfix/t1010-update-workflow | 71ae6c6d9dbf5352a6275760b26a716201c1f1bc | PR closed unmerged |
| bugfix/t643-fix-verify-state-loop | 41e3af42b3556a89facd52844ea0358fbda6819f | PR closed unmerged |
| bugfix/t662-fix-task | 1b7b6c0ffa72d82a741ab44e3fd033247fdb7a72 | PR closed unmerged |
| bugfix/t670-update-logging | a56bd8531c1011c5c374e05e43fd9a024a1fb23b | PR closed unmerged |
| bugfix/t769-fix-task-workflow-status-mismatch | a007fb5862eaaa925c3d3d636b5f6f8cc75fc3e8 | PR closed unmerged |
| bugfix/t840-update-task | dc20c393772313ece5e291f155a16f9fd0dad848 | PR closed unmerged |
| bugfix/t944-update-logging | 77f53e9532d1a42c97af1fec7cb2774fbadbd3d1 | PR closed unmerged |
| bugfix/t945-update-logging | 2a9b39ae4710d6f25b20f8e2c0482a4502014ea3 | PR closed unmerged |
| bugfix/t951-update-agent | 3d3675784aa4550a169606f5ec3e974f3061528e | PR closed unmerged |
| bugfix/t952-update-logging | dae7065d56da354ecccb15ccd49ee0a0d0e66111 | PR closed unmerged |
| bugfix/t953-update-task | ee44b94f09ba0f46f40e0648785b683f4ad445b0 | PR closed unmerged |
| bugfix/t955-fix-task | 973523c63a554f3cf8b3cf81914544159025c84e | PR closed unmerged |
| bugfix/t957-update-task | 4d631e6122fa158c4cd23837607a7f1f652c92d5 | PR closed unmerged |
| bugfix/t962-update-logging | 572eed3ef59932a86077605356e7181c2d0a9e5e | PR closed unmerged |
| bugfix/t964-update-task | f38379e8a83d69359786749013e9bf35c1fbdab8 | PR closed unmerged |
| bugfix/verification-gate-bounds | d6d0aaedb4183f660367a46e1dd86f06172d1c64 | PR closed unmerged |
| bugfix/workflow-status-integrity | 56c06a63b83e15730098d1c4b778a1f52150fe31 | PR closed unmerged |
| chore/t630-split-automated-verifier | 236df77733bc7305d3777c63fbf51acc1b579726 | PR closed unmerged |
| chore/t668-refactor-workflow | 3868c229469f956e15804c7a1ef7a89656df57c5 | PR closed unmerged |
| feature/1340-storybook-8-6-19 | 9ecbafe9bd4c665ac4834e9f58ce868d77c181cd | PR closed unmerged |
| feature/implement-autoexecutionmode | 88c3bed686758a99da53fe4c368cf919c08375c1 | PR closed unmerged |
| feature/implement-perf-t405 | d76d59209463b51fe82c7ec42e65404e1d1f9212 | PR closed unmerged |
| feature/implement-source | 9afcfe8e280e6e56063920873664e4b6cdb71620 | PR closed unmerged |
| feature/implement-task-bcf90c2b | bcf90c2bf7c000a8ac2a2f5a0335c244101ed611 | PR closed unmerged |
| feature/t652-improve-task | e58a70f9dbe496a06defe07269b5ae23ac6cf30e | PR closed unmerged |
| feature/t667-add-config-tests | 0f039b8344d3e6e341097242386cf0499ceda07c | PR closed unmerged |
| feature/t671-verify-tests | 12919c84ba9c2d0849863cdb9e0fa4b9bed82e9b | PR closed unmerged |
| feature/t724-update-ui | 5bc0bebdc82749376927e71001e02e64fb7d68b8 | PR closed unmerged |
| feature/t870-update-workflow-execution | bcb4366c95b843cd9b5541150d6a1454cf273da1 | PR closed unmerged |
| feature/t873-update-task | 6f6db87c90b1fda84eef92b1ad05e6f4facd8e6b | PR closed unmerged |
| feature/t874-add-task | ae2a9185cd966083ea72303759f46d8ad716c0bf | PR closed unmerged |
| feature/t885-update-api | 0c84f2b2e0f693a7befae16abb158e5cea20819f | PR closed unmerged |
| feature/t889-update-execution-task | 919861e4442cf4b0b52448456bb8470ae0f65b64 | PR closed unmerged |
| feature/t896-update-task | 331a19485d3f8ecbe9d3a043e35041e58c5fb5c4 | PR closed unmerged |
| feature/t896-update-task-adc08209 | adc082091a4dad2d09b80bad32847efb0e1c3dac | PR closed unmerged |
| feature/t903-update-execution-task | dda018a27e7354df217ef89b85c6caac20cbf3e6 | PR closed unmerged |
| feature/t907-verify-tests | ebc711db24b8152e30b70d2e7c3cba7f4660edf1 | PR closed unmerged |
| feature/t909-update-task | c0c87344dc6d20783583da80ff170efc4e3d72f2 | PR closed unmerged |
| feature/t917-verify-tests | d76a174b77f2aa054664bb3b4a9bb80a8ac97734 | PR closed unmerged |
| feature/t931-update-task | 46997909ba6a136672a37e35844b7fd91cd4d580 | PR closed unmerged |
| feature/t932-update-execution-logging | a77caf90024d19529843fcb54d4db01283fa02af | PR closed unmerged |
| feature/t934-split-tests-files | 1876dcadedb8655a3dc08948fa7fb9b71b21a15e | PR closed unmerged |
| feature/t937-verify-tests-metrics | 2571b18d4138cb7a323022d856394af18927bfda | PR closed unmerged |
| feature/t940-update-api-execution | c7af77da3bf86686112dd9b8e3c545637ff6ee75 | PR closed unmerged |
| security/t1272-sharp-0355 | 6770804ba5269d13e2fe0a5fe0ee02ee2e462b92 | PR closed unmerged |
| bugfix/fix-task-t415 | 186bf5a49e5fc04ef01236ee6b884fb571a7693a | no PR, 83 days old |
| bugfix/t639-fix-claude-cli-error | 1b60637ee3569dcf360bb1226118f6004529a594 | no PR, 77 days old |
| bugfix/t639-fix-claude-cli-error-8a465f68 | 8a465f68badae282d2315932895c0e1272be5c66 | no PR, 77 days old |
| bugfix/t669-update-task | 69442f75fa9b51c2bb6e6b0d4301076687c8b807 | no PR, 68 days old |
| bugfix/t684-update-task | cf1cf04dfd0719d539dba1008c313fdb8dcac82c | no PR, 68 days old |
| bugfix/t690-update-task | cd0c88081947c004ea572037a2b0482451160f95 | no PR, 68 days old |
| bugfix/t695-update-logging | 52972da4fae07f0b0623f2212d4e7f4cb3184989 | no PR, 68 days old |
| bugfix/t699-update-logging | 719c590bc5469f4241c8c23838b827fa627cf6ac | no PR, 68 days old |
| bugfix/t700-update-logging | 90413b066ba6e3cf6239ed9d2c20370239bf048f | no PR, 68 days old |
| bugfix/t701-update-logging | edc5dee2c93d46370075b8894a3230d3932ce319 | no PR, 68 days old |
| bugfix/t716-update-task | e659cb41f4d5f5c859fdb3ad54c557954dfe477a | no PR, 67 days old |
| bugfix/t735-fix-verify-repair-loop | 7396e3b72437e7aea3b9639fcb2ce167422e5258 | no PR, 66 days old |
| bugfix/t736-add-cpu-time-ms-column | c3180cc62f8cdbd8424269dc692b790cfaa1471e | no PR, 65 days old |
| bugfix/t739-add-missing-cpu-time-column | 6145d85c44d635af45d899426e8f1323ac83e470 | no PR, 65 days old |
| bugfix/t740-fix-agent-execution-cputime | 42ce0e579dc715c5562caf03456ebb478b84d38d | no PR, 65 days old |
| chore/add-test-runner-task | cd675a3b18ccc5be6f061221519e3e3a214c0f6c | no PR, 240 days old |
| chore/split-files-by-responsibility | 22c29cc1134854c019356a61b812a4f08f80b70f | no PR, 243 days old |
| chore/t569-add-sunrise-to-icon-policy | 7fd528010abe2f8c6faf5e8a354cab4265c1c2a3 | no PR, 82 days old |
| chore/unify-subtask-accordion-button-style | 4b999b001bcb99f7f22936293679ff107b23afde | no PR, 231 days old |
| codex/paired-randomization | 0aadb8b62a0dc8bc08cc7ee3ad2f9cb5e48ce818 | no PR, 56 days old |
| codex/planning-log-display | 9c873e89dc9aed74f8f5dc6075736f0aa9dbf0e5 | no PR, 56 days old |
| codex/resume-integration | ca1561d4ce9ea6785bc9dd3906e866c365c0aa61 | no PR, 56 days old |
| codex/supervision-0907 | ff4fb1d55038626d285dca4a69151b81e2427dfd | no PR, 57 days old |
| codex/task894-audit | 20972615245a2a7e85f9773f9468d0764954d184 | no PR, 56 days old |
| feature/idea-icon-colors | 162e348d3a1d4d170b5645cffe9365ebe7bb6b3b | no PR, 188 days old |
| feature/notify-task-execution | 5c539c3417e90a201b7bd5ba31b4b1b074504404 | no PR, 228 days old |
| feature/show-workflow-auto-setting | 5cd646835a9c4406479f82ee3be30f500dfbe76b | no PR, 244 days old |
| feature/t557-add-value-saturation-gate | c6b1eab89aabf039cdc710a2467db4141ee8a409 | no PR, 83 days old |
| feature/t594-add-accessible-stall-recovery | be8231880fb6f8a93d76158f30369da20b1a099e | no PR, 79 days old |
| feature/t707-update-task | ececab320d09025c39c3857d569152f10b26da0d | no PR, 66 days old |
| feature/t722-update-task | 7e2158603832c974c6fe25da569be4711801352d | no PR, 65 days old |
