## ADDED Requirements

### Requirement: ESDF control scheme alongside arrows and vim keys

The game SHALL accept THREE keyboard control schemes simultaneously: arrow keys, vim `hjkl`, and ESDF. In ESDF, `E` SHALL rotate, `S` SHALL move left, `D` SHALL soft-drop, and `F` SHALL move right. Key matching SHALL be case-insensitive. The Space key SHALL remain the hard-drop in all schemes. Adding ESDF SHALL NOT change any existing arrow or `hjkl` mapping.

#### Scenario: ESDF keys map to the right actions

- **WHEN** `keyToAction` is given a keydown for `e`, `s`, `d`, or `f` (or their uppercase forms)
- **THEN** it returns `rotate`, `left`, `softDrop`, and `right` respectively

#### Scenario: Existing schemes unchanged

- **WHEN** `keyToAction` is given `ArrowLeft`/`ArrowRight`/`ArrowDown`/`ArrowUp`, `h`/`l`/`j`/`k`, or Space
- **THEN** it returns the same actions as before this change (`left`/`right`/`softDrop`/`rotate`, and `hardDrop` for Space)

#### Scenario: Cheatsheet lists all schemes

- **WHEN** the controls cheatsheet is rendered
- **THEN** it shows the ESDF keys in addition to the existing keys
