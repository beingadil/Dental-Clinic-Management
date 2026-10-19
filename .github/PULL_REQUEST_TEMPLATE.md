name: Pull request
description: Propose a change to Dental Solutions
title: ''
labels: ''
body:
  - type: markdown
    attributes:
      value: |
        ## What this changes

        <!-- What does this PR do, and why? -->

        ## Why

        <!-- The problem being solved. If it fixes a bug, link the issue. -->

        ## How it was verified

        <!-- Be specific: the exact commands you ran and what they printed. -->

        - [ ] `npm run lint` passes
        - [ ] `npm test` passes
        - [ ] `npm run role:check` passes
        - [ ] `npm run audit:contrast` passes
        - [ ] `npm run audit:darkbar` passes
        - [ ] `npm run build` succeeds
        - [ ] A test fails without this change
        - [ ] `CHANGELOG.md` updated under `## [Unreleased]`
        - [ ] No real patient, clinic or payment data included
        - [ ] Design tokens regenerated via the solver, not hand-edited (if colours changed)
        - [ ] New migration added, not an applied one edited (if the schema changed)
