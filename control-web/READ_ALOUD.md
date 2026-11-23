# Read aloud

After **Ask store** returns an answer, or **Preview** produces a proposed change, click **Read aloud** in the result panel. Click **Stop reading** to stop. Playback never starts automatically and never confirms, changes, or undoes a product update.

Readouts use the existing **Language** selection. English uses an available English browser voice, preferring en-IN. Telugu requires a Telugu browser voice. **Detect automatically** uses English for playback. If the browser cannot provide the requested voice, a message explains how to continue with English or the written details. Browser voice services may require an internet connection; no Gemini or Sarvam key is used for playback.

Spoken answers use the same validated values displayed on screen. A preview reads the current and proposed values and explicitly states that the change has not yet been applied. The existing **Confirm** button remains necessary to apply an update.

Playback stops before microphone recording or an API action starts. It also stops when the displayed result changes, the transcript is edited, the readout language changes, the result is dismissed, or the component is removed. Voice discovery, speech startup and playback each have bounded waiting times; cancelled sessions ignore late browser events.

No backend, store contract, credentials, dependencies or ports are changed. Frontend tests cover spoken values, Telugu messages, language matching, cancellation, late voices, error handling and timeout cleanup. Audible quality and the available English/Telugu voices should be checked in the target user's browser.
