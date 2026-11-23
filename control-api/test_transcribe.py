"""Provider tests use fake keys and mocked audio responses, never live requests."""
import io
import os
import unittest
from unittest.mock import patch

import httpx
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

import main
import sarvam_transcriber as st

REAL_CLIENT = httpx.AsyncClient


class Transcribe(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        p = patch.dict(os.environ, {"SARVAM_API_KEY": "test-placeholder"})
        p.start(); self.addCleanup(p.stop)

    def audio(self, content=b"test-audio", mime="audio/webm;codecs=opus"):
        return UploadFile(io.BytesIO(content), filename="sample.webm", headers=Headers({"content-type": mime}))

    def provider(self, handler):
        def factory(**kwargs):
            self.assertEqual(kwargs["timeout"].connect, 5.0)
            self.assertEqual(kwargs["timeout"].read, 30.0)
            return REAL_CLIENT(timeout=kwargs["timeout"], transport=httpx.MockTransport(handler))
        return patch.object(st.httpx, "AsyncClient", side_effect=factory)

    async def test_success_and_request_contract(self):
        def handler(request):
            self.assertEqual(str(request.url), "https://api.sarvam.ai/speech-to-text")
            self.assertEqual(request.headers["api-subscription-key"], "test-placeholder")
            self.assertIn(b'name="language_code"', request.content)
            self.assertNotIn(b'languageCode', request.content)
            self.assertIn(b'te-IN', request.content)
            self.assertIn(b'saaras:v4', request.content)
            return httpx.Response(200, json={"transcript": "హూడీ ధర 999 చేయి", "language_code": "te-IN"})
        with self.provider(handler):
            result = await st.transcribe_audio(self.audio(), "te-IN")
        self.assertEqual(result["language_code"], "te-IN")
        self.assertIn("999", result["transcript"])

    async def test_missing_key(self):
        with patch.dict(os.environ, {"SARVAM_API_KEY": ""}), self.assertRaises(HTTPException) as e:
            await st.transcribe_audio(self.audio(), "en-IN")
        self.assertEqual(e.exception.status_code, 503)

    async def test_status_returns_only_configuration_flag(self):
        async with REAL_CLIENT(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as api:
            response = await api.get("/api/speech/status")
            self.assertEqual(response.json(), {"sarvam_configured": True})
            with patch.dict(os.environ, {"SARVAM_API_KEY": ""}):
                response = await api.get("/api/speech/status")
                self.assertEqual(response.json(), {"sarvam_configured": False})

    async def test_reject_invalid_inputs_without_network(self):
        for audio, language, status in [(self.audio(), "te", 422), (self.audio(mime="text/plain"), "en-IN", 415),
                                        (self.audio(b""), "unknown", 422),
                                        (self.audio(b"x"*(st.MAX_BYTES+1)), "unknown", 413)]:
            with self.subTest(status=status), patch.object(st.httpx, "AsyncClient") as factory:
                with self.assertRaises(HTTPException) as e: await st.transcribe_audio(audio, language)
                self.assertEqual(e.exception.status_code, status)
                factory.assert_not_called()

    async def test_provider_errors_do_not_expose_details(self):
        for status, expected in [(400, 422), (401, 503), (403, 503), (429, 503), (500, 502), (503, 502)]:
            with self.subTest(status=status), self.provider(lambda req: httpx.Response(status, text="private-provider-detail")):
                with self.assertRaises(HTTPException) as e: await st.transcribe_audio(self.audio(), "unknown")
                self.assertEqual(e.exception.status_code, expected)
                self.assertNotIn("private-provider-detail", e.exception.detail)

    async def test_timeouts_and_network_errors(self):
        for exc, status in [(httpx.ReadTimeout, 504), (httpx.ConnectError, 502)]:
            def handler(request): raise exc("private-provider-detail", request=request)
            with self.provider(handler), self.assertRaises(HTTPException) as e:
                await st.transcribe_audio(self.audio(), "unknown")
            self.assertEqual(e.exception.status_code, status)

    async def test_invalid_provider_responses(self):
        for response, status in [(httpx.Response(200, text="not JSON"), 502),
                                  (httpx.Response(200, json=[]), 502),
                                  (httpx.Response(200, json={"transcript": 3}), 502),
                                  (httpx.Response(200, json={"transcript": "  "}), 422)]:
            with self.provider(lambda req: response), self.assertRaises(HTTPException) as e:
                await st.transcribe_audio(self.audio(), "unknown")
            self.assertEqual(e.exception.status_code, status)

    async def test_http_multipart_route_and_no_side_effects(self):
        before_history, before_pending = list(main.history), dict(main.pending)
        async with REAL_CLIENT(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as api:
            with self.provider(lambda req: httpx.Response(200, json={"transcript": "Set white t-shirt stock to 30", "language_code": "en-IN"})), patch.object(main, "store", side_effect=AssertionError("Transcription must not access store")):
                result = await api.post("/api/transcribe", files={"file": ("voice.webm", b"fake-audio", "audio/webm")}, data={"language_code": "en-IN"})
                self.assertEqual(result.status_code, 200, result.text)
                self.assertEqual(result.json()["language_code"], "en-IN")
        self.assertEqual(main.history, before_history)
        self.assertEqual(main.pending, before_pending)


if __name__ == "__main__": unittest.main()
