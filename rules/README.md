# Rules

This directory contains the **built-in evolution ruleset** used by Evolve My Claw to produce
rule-driven, evidence-driven evolution findings.

## Files

- `builtin.rules.json5`: shipped rules (versioned in git)

## Local overrides (per device)

To customize rules on a specific machine without editing this repo, put JSON5 files here:

`~/.openclaw/evolve-my-claw/rules/*.json5`

Rules in overrides:

- Can **add** new rules
- Can **override** built-in rules by `ruleId`
- Can **disable** a built-in rule by setting `"enabled": false`

## Why JSON5

JSON5 is comment-friendly and easy to edit quickly while iterating on heuristics.

