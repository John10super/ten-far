#!/usr/bin/env python3
"""Build the Morning Briefing .shortcut file.

Produces an UNSIGNED binary plist that the iPhone Shortcuts app can
import when "Allow Sharing Untrusted Shortcuts" is enabled in
Settings -> Shortcuts -> Advanced.

The shortcut greets the user, speaks today's weather in Mandarin, then
reads out:
  * Apple Reminders due today
  * All incomplete / overdue Apple Reminders
  * Apple Calendar events for today
  * Apple Calendar events in the next 24 hours
  * Google Tasks (via Tasks REST API; needs a Bearer token)

All spoken output uses zh-TW (Mandarin) voice.
"""

import plistlib
import uuid
from pathlib import Path

ZH = "zh-TW"
RATE = 0.5
PITCH = 1.0


def new_uuid() -> str:
    return str(uuid.uuid4()).upper()


def magic(var_uuid: str, output_name: str, value_type: str = "ActionOutput"):
    """Build a WFSerializationType=WFTextTokenAttachment dict reference."""
    return {
        "Value": {
            "OutputName": output_name,
            "OutputUUID": var_uuid,
            "Type": value_type,
        },
        "WFSerializationType": "WFTextTokenAttachment",
    }


def text_with_tokens(template: str, tokens: list[tuple[int, dict]]):
    """Build a WFTextTokenString.

    template: the literal string with U+FFFC (object replacement char)
              at each token position.
    tokens:   list of (position, attachment_dict) tuples.
    """
    attachments = {}
    for pos, attachment in tokens:
        attachments[f"{{{pos}, 1}}"] = attachment
    return {
        "Value": {
            "attachmentsByRange": attachments,
            "string": template,
        },
        "WFSerializationType": "WFTextTokenString",
    }


def speak(text_value, lang: str = ZH):
    """Speak Text action (Siri voice). text_value may be a plain str or a token dict."""
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.speaktext",
        "WFWorkflowActionParameters": {
            "WFSpeakTextLanguage": lang,
            "WFSpeakTextRate": RATE,
            "WFSpeakTextPitch": PITCH,
            "WFSpeakTextWaitUntilFinished": True,
            "WFText": text_value,
        },
    }


def gemini_speak(text_value):
    """Run Shortcut: 'Gemini Speak (Zephyr)' with the given text as input.

    Requires the companion sub-shortcut produced by build_gemini_speak.py
    to already be imported on the device under the same name.
    """
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.runworkflow",
        "WFWorkflowActionParameters": {
            "WFWorkflowName": "Gemini Speak (Zephyr)",
            "WFInput": text_value,
            "WFShowResult": False,
        },
    }


def comment(text: str):
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.comment",
        "WFWorkflowActionParameters": {"WFCommentActionText": text},
    }


def set_variable(name: str, uuid_for_output: str = None):
    params = {"WFVariableName": name}
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.setvariable",
        "WFWorkflowActionParameters": params,
    }


def get_variable(name: str):
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.getvariable",
        "WFWorkflowActionParameters": {
            "WFVariable": {
                "Value": {
                    "Type": "Variable",
                    "VariableName": name,
                },
                "WFSerializationType": "WFTextTokenAttachment",
            }
        },
    }


def text_action(value, output_uuid: str):
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.gettext",
        "WFWorkflowActionParameters": {
            "WFTextActionText": value,
            "UUID": output_uuid,
        },
    }


# ----------------------- Weather actions -----------------------

def get_current_weather(output_uuid: str):
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.weather.currentconditions",
        "WFWorkflowActionParameters": {
            "WFWeatherCurrentConditionsLocation": {
                "Value": {"Type": "CurrentLocation"},
                "WFSerializationType": "WFCurrentLocation",
            },
            "UUID": output_uuid,
        },
    }


def get_weather_detail(property_name: str, weather_uuid: str, output_uuid: str):
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.properties.weather.conditions",
        "WFWorkflowActionParameters": {
            "WFContentItemPropertyName": property_name,
            "WFInput": {
                "Value": {
                    "OutputName": "Current Weather",
                    "OutputUUID": weather_uuid,
                    "Type": "ActionOutput",
                },
                "WFSerializationType": "WFTextTokenAttachment",
            },
            "UUID": output_uuid,
        },
    }


# ----------------------- Reminders actions -----------------------

def find_reminders_today(output_uuid: str):
    """Find Reminders where IsCompleted == false AND DueDate is today."""
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.filter.reminders",
        "WFWorkflowActionParameters": {
            "UUID": output_uuid,
            "WFContentItemFilter": {
                "Value": {
                    "WFActionParameterFilterPrefix": 1,  # All
                    "WFActionParameterFilterTemplates": [
                        {
                            "Property": "Is Completed",
                            "Operator": 4,  # is
                            "Values": {"Bool": False},
                            "Removable": True,
                        },
                        {
                            "Property": "Due Date",
                            "Operator": 8,  # is today
                            "Values": {
                                "WFEvaluatedRelativeDateValue": "Today",
                            },
                            "Removable": True,
                        },
                    ],
                },
                "WFSerializationType": "WFContentPredicateTableTemplate",
            },
        },
    }


def find_reminders_incomplete(output_uuid: str):
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.filter.reminders",
        "WFWorkflowActionParameters": {
            "UUID": output_uuid,
            "WFContentItemFilter": {
                "Value": {
                    "WFActionParameterFilterPrefix": 1,
                    "WFActionParameterFilterTemplates": [
                        {
                            "Property": "Is Completed",
                            "Operator": 4,
                            "Values": {"Bool": False},
                            "Removable": True,
                        }
                    ],
                },
                "WFSerializationType": "WFContentPredicateTableTemplate",
            },
        },
    }


# ----------------------- Calendar actions -----------------------

def find_events_today(output_uuid: str):
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.filter.calendarevents",
        "WFWorkflowActionParameters": {
            "UUID": output_uuid,
            "WFContentItemFilter": {
                "Value": {
                    "WFActionParameterFilterPrefix": 1,
                    "WFActionParameterFilterTemplates": [
                        {
                            "Property": "Start Date",
                            "Operator": 8,  # is today
                            "Values": {"WFEvaluatedRelativeDateValue": "Today"},
                            "Removable": True,
                        }
                    ],
                },
                "WFSerializationType": "WFContentPredicateTableTemplate",
            },
        },
    }


def find_events_next_24h(output_uuid: str):
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.filter.calendarevents",
        "WFWorkflowActionParameters": {
            "UUID": output_uuid,
            "WFContentItemFilter": {
                "Value": {
                    "WFActionParameterFilterPrefix": 1,
                    "WFActionParameterFilterTemplates": [
                        {
                            "Property": "Start Date",
                            "Operator": 1002,  # is between
                            "Values": {
                                "WFEvaluatedRelativeDateRangeStart": "Now",
                                "WFEvaluatedRelativeDateRangeEnd": "Tomorrow",
                            },
                            "Removable": True,
                        }
                    ],
                },
                "WFSerializationType": "WFContentPredicateTableTemplate",
            },
        },
    }


# ----------------------- Repeat helpers -----------------------

def repeat_each_start(input_uuid: str, group_uuid: str):
    """Repeat with Each: input must be the magic-variable dict."""
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.repeat.each",
        "WFWorkflowActionParameters": {
            "GroupingIdentifier": group_uuid,
            "WFControlFlowMode": 0,  # start
            "WFInput": {
                "Value": {
                    "OutputName": "Filtered List",
                    "OutputUUID": input_uuid,
                    "Type": "ActionOutput",
                },
                "WFSerializationType": "WFTextTokenAttachment",
            },
        },
    }


def repeat_each_end(group_uuid: str):
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.repeat.each",
        "WFWorkflowActionParameters": {
            "GroupingIdentifier": group_uuid,
            "WFControlFlowMode": 2,  # end
        },
    }


def get_item_property(prop: str, output_uuid: str, source_var: str = "Repeat Item"):
    """Get a named property (e.g. 'Name', 'Start Date') from Repeat Item."""
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.properties.reminders",
        "WFWorkflowActionParameters": {
            "UUID": output_uuid,
            "WFContentItemPropertyName": prop,
            "WFInput": {
                "Value": {
                    "Type": "Variable",
                    "VariableName": source_var,
                },
                "WFSerializationType": "WFTextTokenAttachment",
            },
        },
    }


# ----------------------- Google Tasks actions -----------------------

GOOGLE_TASKS_URL = "https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?showCompleted=false&maxResults=100"


def get_url_contents(url: str, token_var_uuid: str, output_uuid: str):
    """Call Google Tasks REST API.

    The Authorization header value is built as 'Bearer ' + token text
    coming from the action whose UUID is token_var_uuid.
    """
    auth_value = text_with_tokens(
        "Bearer ￼",
        [(7, magic(token_var_uuid, "Text"))],
    )
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
        "WFWorkflowActionParameters": {
            "UUID": output_uuid,
            "WFHTTPMethod": "GET",
            "WFURL": url,
            "WFHTTPHeaders": {
                "Value": {
                    "WFDictionaryFieldValueItems": [
                        {
                            "WFItemType": 0,
                            "WFKey": {
                                "Value": {"string": "Authorization"},
                                "WFSerializationType": "WFTextTokenString",
                            },
                            "WFValue": auth_value,
                        },
                        {
                            "WFItemType": 0,
                            "WFKey": {
                                "Value": {"string": "Accept"},
                                "WFSerializationType": "WFTextTokenString",
                            },
                            "WFValue": {
                                "Value": {"string": "application/json"},
                                "WFSerializationType": "WFTextTokenString",
                            },
                        },
                    ]
                },
                "WFSerializationType": "WFDictionaryFieldValue",
            },
        },
    }


def get_dictionary_value(key: str, source_uuid: str, source_name: str, output_uuid: str):
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.getvalueforkey",
        "WFWorkflowActionParameters": {
            "UUID": output_uuid,
            "WFDictionaryKey": key,
            "WFInput": {
                "Value": {
                    "OutputName": source_name,
                    "OutputUUID": source_uuid,
                    "Type": "ActionOutput",
                },
                "WFSerializationType": "WFTextTokenAttachment",
            },
        },
    }


# ----------------------- Build the workflow -----------------------

def build(speaker=speak, name: str = "早安田總 Morning Briefing"):
    """Build the morning-briefing workflow.

    speaker: callable(text_value) returning an action dict. Pass `speak`
             for Siri voice or `gemini_speak` for Gemini Zephyr voice.
    """
    actions = []

    # --- Greeting ---
    actions.append(comment("=== 早安問候 ==="))
    actions.append(speaker("早安田總"))

    # --- Weather ---
    actions.append(comment("=== 取得目前天氣 ==="))
    weather_uuid = new_uuid()
    actions.append(get_current_weather(weather_uuid))

    city_uuid = new_uuid()
    actions.append(get_weather_detail("City", weather_uuid, city_uuid))
    cond_uuid = new_uuid()
    actions.append(get_weather_detail("Conditions", weather_uuid, cond_uuid))
    temp_uuid = new_uuid()
    actions.append(get_weather_detail("Temperature", weather_uuid, temp_uuid))

    # Build "今天{city}的天氣是{cond}，溫度{temp}"
    # U+FFFC is object replacement char. Compute byte positions of each.
    p1 = "今天"
    p2 = "的天氣是"
    p3 = "，溫度"
    template = f"{p1}￼{p2}￼{p3}￼"
    # Positions are by UTF-16 code units; for BMP chars that's char count.
    pos_city = len(p1)
    pos_cond = pos_city + 1 + len(p2)
    pos_temp = pos_cond + 1 + len(p3)
    weather_text = text_with_tokens(
        template,
        [
            (pos_city, magic(city_uuid, "City")),
            (pos_cond, magic(cond_uuid, "Conditions")),
            (pos_temp, magic(temp_uuid, "Temperature")),
        ],
    )
    actions.append(speaker(weather_text))

    # --- Reminders due today ---
    actions.append(comment("=== 今日提醒事項 ==="))
    actions.append(speaker("今天的提醒事項："))
    r_today_uuid = new_uuid()
    actions.append(find_reminders_today(r_today_uuid))
    grp1 = new_uuid()
    actions.append(repeat_each_start(r_today_uuid, grp1))
    name_uuid_a = new_uuid()
    actions.append(get_item_property("Name", name_uuid_a))
    actions.append(speaker(
        text_with_tokens("￼", [(0, magic(name_uuid_a, "Name"))])
    ))
    actions.append(repeat_each_end(grp1))

    # --- Reminders incomplete (overdue + future) ---
    actions.append(comment("=== 所有未完成提醒 ==="))
    actions.append(speaker("以下是所有未完成的提醒："))
    r_inc_uuid = new_uuid()
    actions.append(find_reminders_incomplete(r_inc_uuid))
    grp2 = new_uuid()
    actions.append(repeat_each_start(r_inc_uuid, grp2))
    name_uuid_b = new_uuid()
    actions.append(get_item_property("Name", name_uuid_b))
    actions.append(speaker(
        text_with_tokens("￼", [(0, magic(name_uuid_b, "Name"))])
    ))
    actions.append(repeat_each_end(grp2))

    # --- Calendar events today ---
    actions.append(comment("=== 今日行事曆 ==="))
    actions.append(speaker("今天的行程："))
    e_today_uuid = new_uuid()
    actions.append(find_events_today(e_today_uuid))
    grp3 = new_uuid()
    actions.append(repeat_each_start(e_today_uuid, grp3))
    title_uuid = new_uuid()
    actions.append(get_item_property("Title", title_uuid))
    actions.append(speaker(
        text_with_tokens("￼", [(0, magic(title_uuid, "Title"))])
    ))
    actions.append(repeat_each_end(grp3))

    # --- Calendar events next 24h ---
    actions.append(comment("=== 未來 24 小時行程 ==="))
    actions.append(speaker("接下來 24 小時的行程："))
    e_24_uuid = new_uuid()
    actions.append(find_events_next_24h(e_24_uuid))
    grp4 = new_uuid()
    actions.append(repeat_each_start(e_24_uuid, grp4))
    title_uuid2 = new_uuid()
    actions.append(get_item_property("Title", title_uuid2))
    actions.append(speaker(
        text_with_tokens("￼", [(0, magic(title_uuid2, "Title"))])
    ))
    actions.append(repeat_each_end(grp4))

    # --- Google Tasks ---
    actions.append(comment(
        "=== Google Tasks ===\n"
        "請編輯下方 Text 動作，貼上你的 OAuth Bearer Token。\n"
        "取得方式請參考 README。"
    ))
    token_uuid = new_uuid()
    actions.append(text_action("PASTE_YOUR_GOOGLE_OAUTH_BEARER_TOKEN_HERE", token_uuid))

    api_uuid = new_uuid()
    actions.append(get_url_contents(GOOGLE_TASKS_URL, token_uuid, api_uuid))

    items_uuid = new_uuid()
    actions.append(get_dictionary_value("items", api_uuid, "Contents of URL", items_uuid))

    actions.append(speaker("以下是 Google Tasks 待辦事項："))
    grp5 = new_uuid()
    actions.append(repeat_each_start(items_uuid, grp5))
    g_title_uuid = new_uuid()
    actions.append(get_dictionary_value("title", "", "Repeat Item", g_title_uuid))
    # Above: source_uuid is empty; tweak to use Variable instead.
    # Replace WFInput with a Variable reference to Repeat Item:
    actions[-1]["WFWorkflowActionParameters"]["WFInput"] = {
        "Value": {"Type": "Variable", "VariableName": "Repeat Item"},
        "WFSerializationType": "WFTextTokenAttachment",
    }
    actions.append(speaker(
        text_with_tokens("￼", [(0, magic(g_title_uuid, "Dictionary Value"))])
    ))
    actions.append(repeat_each_end(grp5))

    # --- Closing ---
    actions.append(speaker("以上是今日簡報，祝您有美好的一天。"))

    workflow = {
        "WFWorkflowActions": actions,
        "WFWorkflowClientVersion": "2900.0.1",
        "WFWorkflowClientRelease": "26.5",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionNoUpgradeWarning": 900,
        "WFWorkflowIcon": {
            "WFWorkflowIconStartColor": 4282601983,
            "WFWorkflowIconGlyphNumber": 59512,
        },
        "WFWorkflowImportQuestions": [],
        "WFWorkflowInputContentItemClasses": [
            "WFAppContentItem",
            "WFAppStoreAppContentItem",
            "WFArticleContentItem",
            "WFContactContentItem",
            "WFDateContentItem",
            "WFEmailAddressContentItem",
            "WFGenericFileContentItem",
            "WFImageContentItem",
            "WFiTunesProductContentItem",
            "WFLocationContentItem",
            "WFDCMapsLinkContentItem",
            "WFAVAssetContentItem",
            "WFPDFContentItem",
            "WFPhoneNumberContentItem",
            "WFRichTextContentItem",
            "WFSafariWebPageContentItem",
            "WFStringContentItem",
            "WFURLContentItem",
        ],
        "WFWorkflowTypes": [],
        "WFQuickActionSurfaces": [],
        "WFWorkflowHasOutputFallback": False,
        "WFWorkflowHasShortcutInputVariables": False,
        "WFWorkflowName": name,
    }
    return workflow


def _dump(workflow, out_dir, stem):
    xml_path = out_dir / f"{stem}.plist"
    bin_path = out_dir / f"{stem}.shortcut"
    with xml_path.open("wb") as f:
        plistlib.dump(workflow, f, fmt=plistlib.FMT_XML)
    with bin_path.open("wb") as f:
        plistlib.dump(workflow, f, fmt=plistlib.FMT_BINARY)
    print(f"Wrote {xml_path}")
    print(f"Wrote {bin_path}  ({len(workflow['WFWorkflowActions'])} actions)")


def main():
    out_dir = Path(__file__).parent
    # Siri voice — works out of the box, no API key
    _dump(build(speaker=speak, name="早安田總 Morning Briefing"),
          out_dir, "morning-briefing")
    # Gemini Zephyr voice — calls the sub-shortcut for each utterance
    _dump(build(speaker=gemini_speak, name="早安田總 Morning Briefing (Gemini)"),
          out_dir, "morning-briefing-gemini")


if __name__ == "__main__":
    main()
