# Contributing to Amazon Seller Revealer

First off, thank you for considering contributing! It’s people like you who make this tool better for the Amazon seller community.

## 🛠 How Can I Contribute?

### Reporting Bugs
* Use the **Bug Report** template in the Issues tab.
* Provide a specific Amazon URL where the issue occurs.
* Include your script version and browser name.

### Suggesting Enhancements
* Check if the feature has already been requested.
* Use the **Feature Request** template to explain why the feature is useful for sellers.

### Pull Requests (Code Changes)
1. **Fork the repo** and create your branch from `main`.
2. **Stick to the style**: Keep the UI clean and consistent with the existing Amazon-style buttons.
3. **No logic changes**: If you are optimizing the extraction logic, ensure it still supports all listed Amazon domains (.in, .com, .de, etc.).
4. **Update the Metadata**: If your change is significant, increment the version in the `// ==UserScript==` block.
5. **Document your changes**: Use clear labels (`feature`, `bug`, or `chore`) so the [Release Drafter](https://github.com/Smart-rwl/Amazon-Reveal-Seller/actions) can categorize them correctly.

## 📜 Coding Guidelines
* Use **'use strict'** at the top of the function.
* Use `GM_config` for any user-adjustable settings.
* Avoid heavy external libraries; keep the script lightweight for fast page loads.

## ⚖️ License
By contributing, you agree that your contributions will be licensed under the project's **MIT License**.
