#!/usr/bin/env python3
"""Build `gemini-speak.shortcut` — a sub-shortcut that speaks its
text input using Google's Gemini 2.5 Flash TTS (voice: Zephyr).

The main morning-briefing-gemini shortcut calls this via
`Run Shortcut` so we don't have to inline ~15 actions per utterance.

Flow inside this sub-shortcut:
  1. Capture Shortcut Input as `speech`
  2. Hold the API key in a Text action (user edits once after import)
  3. JSON-escape `speech`  (backslash first, then double-quote, then newline)
  4. Build the JSON request body via a Text action with tokens
  5. POST to the Gemini TTS endpoint
  6. Walk down to `candidates[0].content.parts[0].inlineData.data`
     -- the base64-encoded raw PCM (24 kHz mono, 16-bit)
  7. Prepend a 54-byte WAV header (RIFF/data size = 0xFFFFFFFF,
     JUNK-padded to a 3-byte boundary so base64 concat is safe)
  8. Base64-decode the combined string to bytes
  9. Rename to speech.wav
 10. Play Sound
"""

import base64
import plistlib
import struct
import uuid
from pathlib import Path

VOICE_NAME = "Zephyr"
TTS_MODEL = "gemini-2.5-flash-preview-tts"


def wav_header_b64() -> str:
    """54-byte WAV header for 24 kHz mono 16-bit PCM."""
    header = (
        b"RIFF\xff\xff\xff\xffWAVEfmt "
        + struct.pack("<IHHIIHH", 16, 1, 1, 24000, 48000, 2, 16)
        + b"JUNK" + struct.pack("<I", 2) + b"\x00\x00"
        + b"data\xff\xff\xff\xff"
    )
    assert len(header) == 54 and len(header) % 3 == 0
    return base64.b64encode(header).decode("ascii")


WAV_HEADER_B64 = wav_header_b64()


def new_uuid() -> str:
    return str(uuid.uuid4()).upper()


def var_token(name: str) -> dict:
    return {
        "Value": {"Type": "Variable", "VariableName": name},
        "WFSerializationType": "WFTextTokenAttachment",
    }


def output_token(uuid_str: str, name: str) -> dict:
    return {
        "Value": {"OutputName": name, "OutputUUID": uuid_str, "Type": "ActionOutput"},
        "WFSerializationType": "WFTextTokenAttachment",
    }


def shortcut_input_token() -> dict:
    return {
        "Value": {"Type": "ExtensionInput"},
        "WFSerializationType": "WFTextTokenAttachment",
    }


def text_with_tokens(template: str, tokens: list) -> dict:
    """tokens: list of (position, attachment dict)."""
    attachments = {f"{{{pos}, 1}}": attach for pos, attach in tokens}
    return {
        "Value": {"attachmentsByRange": attachments, "string": template},
        "WFSerializationType": "WFTextTokenString",
    }


def text_action(value, output_uuid: str) -> dict:
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.gettext",
        "WFWorkflowActionParameters": {
            "WFTextActionText": value,
            "UUID": output_uuid,
        },
    }


def set_variable(name: str) -> dict:
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.setvariable",
        "WFWorkflowActionParameters": {"WFVariableName": name},
    }


def comment(text: str) -> dict:
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.comment",
        "WFWorkflowActionParameters": {"WFCommentActionText": text},
    }


def replace_text(find: str, replace: str, input_token: dict, output_uuid: str) -> dict:
    """`is.workflow.actions.text.replace` — literal (non-regex) replace."""
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.text.replace",
        "WFWorkflowActionParameters": {
            "UUID": output_uuid,
            "WFReplaceTextFind": find,
            "WFReplaceTextReplace": replace,
            "WFReplaceTextCaseSensitive": True,
            "WFReplaceTextRegularExpression": False,
            "WFInput": input_token,
        },
    }


def post_url(url_token: dict, body_token: dict, output_uuid: str) -> dict:
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
        "WFWorkflowActionParameters": {
            "UUID": output_uuid,
            "WFHTTPMethod": "POST",
            "WFURL": url_token,
            "WFHTTPBodyType": "File",
            "WFRequestVariable": body_token,
            "WFHTTPHeaders": {
                "Value": {
                    "WFDictionaryFieldValueItems": [
                        {
                            "WFItemType": 0,
                            "WFKey": {
                                "Value": {"string": "Content-Type"},
                                "WFSerializationType": "WFTextTokenString",
                            },
                            "WFValue": {
                                "Value": {"string": "application/json"},
                                "WFSerializationType": "WFTextTokenString",
                            },
                        }
                    ]
                },
                "WFSerializationType": "WFDictionaryFieldValue",
            },
        },
    }


def get_dict_value(key: str, source: dict, output_uuid: str) -> dict:
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.getvalueforkey",
        "WFWorkflowActionParameters": {
            "UUID": output_uuid,
            "WFDictionaryKey": key,
            "WFInput": source,
        },
    }


def get_item_from_list(source: dict, output_uuid: str, index: int = 0) -> dict:
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.getitemfromlist",
        "WFWorkflowActionParameters": {
            "UUID": output_uuid,
            "WFItemSpecifier": "First Item" if index == 0 else "Item At Index",
            "WFItemIndex": index,
            "WFInput": source,
        },
    }


def base64_decode(input_token: dict, output_uuid: str) -> dict:
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.base64encode",
        "WFWorkflowActionParameters": {
            "UUID": output_uuid,
            "WFEncodeMode": "Decode",
            "WFInput": input_token,
        },
    }


def set_name(new_name: str, input_token: dict, output_uuid: str) -> dict:
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.file.rename",
        "WFWorkflowActionParameters": {
            "UUID": output_uuid,
            "WFNewFileName": new_name,
            "WFFile": input_token,
        },
    }


def play_sound(input_token: dict) -> dict:
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.playsound",
        "WFWorkflowActionParameters": {"WFInput": input_token},
    }


# ----------------------- Build -----------------------

def build_gemini_speak() -> dict:
    actions: list = []

    actions.append(comment(
        "Gemini Speak (Zephyr)\n"
        "把 Shortcut Input 的文字用 Gemini 2.5 Flash TTS 唸出來。\n"
        "第一次使用請編輯下方 API key 的 Text 動作。"
    ))

    # 1. Capture input -> `speech`
    actions.append(text_action(
        text_with_tokens("￼", [(0, shortcut_input_token())]),
        new_uuid(),
    ))
    actions.append(set_variable("speech"))

    # 2. API key -> `apiKey`
    actions.append(text_action("PASTE_YOUR_GEMINI_API_KEY_HERE", new_uuid()))
    actions.append(set_variable("apiKey"))

    # 3. JSON-escape speech.  Order matters: backslash first.
    esc1_uuid = new_uuid()
    actions.append(replace_text("\\", "\\\\", var_token("speech"), esc1_uuid))
    esc2_uuid = new_uuid()
    actions.append(replace_text("\"", "\\\"", output_token(esc1_uuid, "Updated Text"), esc2_uuid))
    esc3_uuid = new_uuid()
    actions.append(replace_text("\n", "\\n", output_token(esc2_uuid, "Updated Text"), esc3_uuid))
    actions.append(set_variable("speechJson"))

    # 4. Build JSON body text
    json_template = (
        '{"contents":[{"parts":[{"text":"￼"}]}],'
        '"generationConfig":{"responseModalities":["AUDIO"],'
        '"speechConfig":{"voiceConfig":{"prebuiltVoiceConfig":{"voiceName":"'
        + VOICE_NAME
        + '"}}}}}'
    )
    pos = json_template.index("￼")
    body_uuid = new_uuid()
    actions.append(text_action(
        text_with_tokens(json_template, [(pos, var_token("speechJson"))]),
        body_uuid,
    ))

    # 5. Build URL text
    url_template = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{TTS_MODEL}:generateContent?key=￼"
    )
    url_pos = url_template.index("￼")
    url_uuid = new_uuid()
    actions.append(text_action(
        text_with_tokens(url_template, [(url_pos, var_token("apiKey"))]),
        url_uuid,
    ))

    # 6. POST
    resp_uuid = new_uuid()
    actions.append(post_url(
        output_token(url_uuid, "Text"),
        output_token(body_uuid, "Text"),
        resp_uuid,
    ))

    # 7. Walk down to inlineData.data
    cand_uuid = new_uuid()
    actions.append(get_dict_value("candidates", output_token(resp_uuid, "Contents of URL"), cand_uuid))
    cand0_uuid = new_uuid()
    actions.append(get_item_from_list(output_token(cand_uuid, "Dictionary Value"), cand0_uuid, 0))
    content_uuid = new_uuid()
    actions.append(get_dict_value("content", output_token(cand0_uuid, "Item from List"), content_uuid))
    parts_uuid = new_uuid()
    actions.append(get_dict_value("parts", output_token(content_uuid, "Dictionary Value"), parts_uuid))
    part0_uuid = new_uuid()
    actions.append(get_item_from_list(output_token(parts_uuid, "Dictionary Value"), part0_uuid, 0))
    inline_uuid = new_uuid()
    actions.append(get_dict_value("inlineData", output_token(part0_uuid, "Item from List"), inline_uuid))
    data_uuid = new_uuid()
    actions.append(get_dict_value("data", output_token(inline_uuid, "Dictionary Value"), data_uuid))
    actions.append(set_variable("audioB64"))

    # 8. Combine WAV header + audio base64
    combined_uuid = new_uuid()
    actions.append(text_action(
        text_with_tokens(WAV_HEADER_B64 + "￼", [(len(WAV_HEADER_B64), var_token("audioB64"))]),
        combined_uuid,
    ))

    # 9. Base64 decode -> file
    decoded_uuid = new_uuid()
    actions.append(base64_decode(output_token(combined_uuid, "Text"), decoded_uuid))

    # 10. Rename to .wav
    named_uuid = new_uuid()
    actions.append(set_name("speech.wav", output_token(decoded_uuid, "File"), named_uuid))

    # 11. Play
    actions.append(play_sound(output_token(named_uuid, "Renamed File")))

    workflow = {
        "WFWorkflowActions": actions,
        "WFWorkflowClientVersion": "2900.0.1",
        "WFWorkflowClientRelease": "26.5",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionNoUpgradeWarning": 900,
        "WFWorkflowIcon": {
            "WFWorkflowIconStartColor": 4292311040,  # orange-ish
            "WFWorkflowIconGlyphNumber": 59650,
        },
        "WFWorkflowImportQuestions": [],
        "WFWorkflowInputContentItemClasses": [
            "WFStringContentItem",
            "WFRichTextContentItem",
        ],
        "WFWorkflowTypes": [],
        "WFQuickActionSurfaces": [],
        "WFWorkflowHasOutputFallback": False,
        "WFWorkflowHasShortcutInputVariables": True,
        "WFWorkflowName": "Gemini Speak (Zephyr)",
    }
    return workflow


def main():
    out_dir = Path(__file__).parent
    wf = build_gemini_speak()

    xml = out_dir / "gemini-speak.plist"
    binp = out_dir / "gemini-speak.shortcut"

    with xml.open("wb") as f:
        plistlib.dump(wf, f, fmt=plistlib.FMT_XML)
    with binp.open("wb") as f:
        plistlib.dump(wf, f, fmt=plistlib.FMT_BINARY)

    print(f"Wrote {xml}")
    print(f"Wrote {binp}")
    print(f"Total actions: {len(wf['WFWorkflowActions'])}")


if __name__ == "__main__":
    main()
