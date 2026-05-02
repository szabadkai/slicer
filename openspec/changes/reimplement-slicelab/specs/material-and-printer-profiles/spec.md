## ADDED Requirements

### Requirement: Built-in resin material library

The system SHALL ship a built-in library of at least 21 resin material presets (covering Siraya Tech, Anycubic, Elegoo families) with the following per-material properties: id, display name, vendor, color (sRGB), transmission, roughness, density (g/cm³), default normal exposure, and default bottom exposure.

#### Scenario: Material library is non-empty on startup
- **WHEN** the app starts
- **THEN** the material picker lists at least 21 presets and a default material is selected.

#### Scenario: Selecting a material applies appearance and defaults
- **WHEN** the user picks a material with color #FFAA00 and default normal exposure 2.5 s
- **THEN** all models on the active plate render with that color and the slicing panel's normal exposure input shows 2.5 s.

### Requirement: Built-in printer profile library

The system SHALL ship at least 10 printer profiles (covering Anycubic Photon, Elegoo Mars/Saturn, Phrozen Sonic, Creality HALOT, UniFormation GKtwo, Formlabs Form 4) with: id, display name, vendor, image, description, build width / depth / height (mm), screen resolution X / Y (px), and default lift height/speed.

#### Scenario: Printer chooser shows previews
- **WHEN** the user opens the printer modal
- **THEN** every printer card shows its name, image, build volume, and resolution.

#### Scenario: Switching printer updates build volume and pixel pitch
- **WHEN** the user picks a printer with build width 218.88 mm and resolution X 11520 px
- **THEN** the viewport build-volume box width becomes 218.88 mm and slicing computes a pixel pitch of 218.88 / 11520 mm/px.

### Requirement: Apply material per-plate or to all plates

The system SHALL apply a material change to the active plate by default and provide an explicit "Apply to all plates" action that sets the same material on every plate.

#### Scenario: Apply to active plate only
- **WHEN** the user changes material on plate 1 with two plates present
- **THEN** plate 2's material is unchanged.

#### Scenario: Apply to all plates
- **WHEN** the user clicks "Apply to all plates"
- **THEN** every plate's material is set to the active material.
