# Contributing to Reveal Seller

First off, thank you for considering contributing to **Reveal Seller**! It’s people like you who make this tool better for the Amazon seller community.

## 🛠 How Can I Contribute?

### Reporting Bugs
* Check the **Issues** tab to see if the bug has already been reported.
* If not, open a new issue. Include:
    * Your browser and userscript manager (e.g., Chrome + Tampermonkey).
    * The specific Amazon domain where the issue occurred (e.g., .in, .com).
    * A screenshot of the console errors if possible.

### Suggesting Enhancements
* We love new ideas! Open an issue with the tag `enhancement` to describe the feature you'd like to see (e.g., new data columns for the CSV).

### Pull Requests
1. **Fork** the repository.
2. **Create a branch** for your fix or feature (`git checkout -b feature/AmazingFeature`).
3. **Commit your changes** (`git commit -m 'Add some AmazingFeature'`).
4. **Push to the branch** (`git push origin feature/AmazingFeature`).
5. **Open a Pull Request**.

## 📜 Coding Guidelines
* **Preserve Layout**: Ensure any new UI elements don't create "blank spaces" or disrupt the native Amazon experience.
* **Keep Logic Clean**: Maintain the separation between data collection and UI rendering.
* **Metadata**: If you add support for a new domain, remember to update the `@match` and translated `@name` tags in the header.

## ⚖️ License
By contributing, you agree that your contributions will be licensed under the project's **MIT License**.
