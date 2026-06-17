# Step 10 — Auto-Popup Modal (Destination Platform)

**Phase:** UI & Integration  
**Status:** Not Started  
**Depends On:** Step 04 (handoff storage), Step 03 (content script boot sequence)  

---

## Objective

Implement `content/autopopup.js` — the small modal that automatically appears in the bottom-right corner when the user navigates to an AI platform with a pending handoff. At the end of this step, the inject flow is triggered correctly and the modal dismisses cleanly in all scenarios.

---

## Files Modified

| File | Action |
|---|---|
| `content/autopopup.js` | Full implementation |
| `ui/sidebar.css` | Auto-popup styles added |

---

## Modal Layout

```
+----------------------------------------+
|  [ContextBridge icon]                  |
|  You have a pending handoff from       |
|  Claude (2 hours ago)                  |
|                                        |
|  "Photosynthesis — Light reactions"    |
|                                        |
|  [ Review & Inject ]  [ Dismiss ]      |
|                                        |
|  [ ] Don't show on this platform       |
+----------------------------------------+
           Auto-dismisses in 30s
```

---

## Display Conditions

The auto-popup is shown if ALL of the following are true:

1. Current platform is one of the 5 supported platforms
2. There is at least one handoff with `status === 'pending'`
3. The handoff's `sourcePlatform` is different from the current platform (no same-platform inject)
4. The user has NOT suppressed auto-popup for this platform (checked via settings)
5. The popup has not already been shown in this page session (session flag in memory)

---

## Auto-Popup Lifecycle

```
initAutoPopup(platform, handoffs, shadowRoot):
  1. Filter handoffs: pending + different source platform
  2. If none → exit silently
  3. Check settings.suppressedPlatforms → if platform suppressed, exit
  4. If session flag 'popup_shown' is true → exit (only show once per page load)
  5. Create modal DOM, inject into shadowRoot
  6. Animate in: slideUp from bottom
  7. Set 30-second auto-dismiss timer
  8. Set session flag 'popup_shown' = true
```

If there are multiple pending handoffs, show the **most recent** one in the modal. The user can access others from the sidebar.

---

## Modal Actions

### "Review & Inject"

```
1. Clear the 30s auto-dismiss timer
2. Hide the auto-popup modal (animate out)
3. Open the sidebar (call initSidebar or send CB_OPEN_SIDEBAR)
4. Pre-select the handoff from the popup in the sidebar's inject view
5. Sidebar jumps directly to "review before inject" state with this handoff's summary pre-loaded
```

### "Dismiss"

```
1. Clear the 30s auto-dismiss timer
2. Animate modal out
3. Do NOT delete the handoff — it remains pending
4. Set session flag: popup dismissed this session (won't re-show on SPA navigation)
```

### "Don't show on this platform" checkbox

```
On check:
  1. sendToBackground({ action: 'SAVE_SETTINGS', payload: { suppressedPlatforms: [...current, platform] } })
  2. Animate modal out
  3. Handoff remains pending
  4. Next visit to this platform — popup will not appear

On uncheck (reversible from sidebar Settings section):
  1. sendToBackground({ action: 'SAVE_SETTINGS', payload: { suppressedPlatforms: current.filter(p => p !== platform) } })
```

### Auto-Dismiss (30 seconds)

```
1. Timer fires after 30,000ms
2. Animate modal out
3. Handoff remains pending
4. Session flag remains set — popup won't re-appear on SPA navigation
5. No action is taken on the handoff
```

---

## Animation Spec

```css
/* Entry: slide up from bottom */
@keyframes cb-popup-in {
  from { transform: translateY(120%); opacity: 0; }
  to   { transform: translateY(0);    opacity: 1; }
}

/* Exit: slide down */
@keyframes cb-popup-out {
  from { transform: translateY(0);    opacity: 1; }
  to   { transform: translateY(120%); opacity: 0; }
}

#cb-autopopup {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 320px;
  z-index: 2147483646; /* one below sidebar host */
  animation: cb-popup-in 0.3s ease forwards;
}
```

---

## Auto-Popup vs Sidebar Coexistence

- The auto-popup and sidebar can be open simultaneously.
- The auto-popup injects into the same shadowRoot as the sidebar.
- They do not overlap — the popup is bottom-right, the sidebar is full-height right.
- If the sidebar is already open when the popup appears, skip the popup entirely (sidebar already visible).

---

## Countdown Timer Display (Optional Enhancement)

A small countdown indicator (e.g., a shrinking border or "Dismissing in 28s" text) can be shown on the modal. This is implemented as a CSS animation on a progress border rather than a JS interval:

```css
#cb-popup-timer-bar {
  height: 2px;
  background: var(--cb-accent);
  animation: cb-shrink 30s linear forwards;
}
@keyframes cb-shrink {
  from { width: 100%; }
  to   { width: 0%; }
}
```

---

## Session Flag (In-Memory Only)

The "already shown this session" flag is a plain JS module variable — not persisted to storage:

```js
// In autopopup.js module scope
let popupShownThisSession = false;

export function initAutoPopup(platform, handoffs, shadowRoot) {
  if (popupShownThisSession) return;
  // ... rest of logic
  popupShownThisSession = true;
}
```

This resets on every full page navigation but persists across SPA route changes within the same page load — exactly the right behavior.

---

## Validation Checklist

- [ ] Modal appears automatically when navigating to a different platform with a pending handoff
- [ ] Modal shows correct source platform name and handoff age
- [ ] Modal shows the chat title of the pending handoff
- [ ] "Review & Inject" opens the sidebar with the correct handoff pre-loaded
- [ ] "Dismiss" hides the modal but does not delete the handoff
- [ ] Auto-dismiss fires after 30 seconds — modal disappears, handoff remains
- [ ] Countdown animation runs for the full 30-second duration
- [ ] "Don't show on this platform" checkbox persists the preference
- [ ] Popup does not re-appear on SPA navigation within the same page session
- [ ] Popup does not appear when source and destination platform are the same
- [ ] Popup does not appear when there are no pending handoffs
- [ ] Modal does not block interaction with the underlying AI platform
