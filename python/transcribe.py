"""faster-whisper transcription for Mixtape (fallback when whisper-cpp is not installed).

Usage: python transcribe.py <media> <out.json> [model] [language]
Writes {"segments": [{"start", "end", "text"}]}. Output stays in .cache/.
"""

import json
import sys


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: transcribe.py <media> <out.json> [model] [language]", file=sys.stderr)
        return 2
    media, out = sys.argv[1], sys.argv[2]
    model_name = sys.argv[3] if len(sys.argv) > 3 else "small"
    language = sys.argv[4] if len(sys.argv) > 4 else "en"

    from faster_whisper import WhisperModel  # imported late so --help works without it

    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, _info = model.transcribe(media, language=None if language == "auto" else language, vad_filter=True)
    data = {"segments": [{"start": s.start, "end": s.end, "text": s.text} for s in segments]}
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
