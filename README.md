# Reveal Seller - (Auto-CSV + Clickable Ratings + Reset)

A powerful browser userscript designed for Amazon sellers and power users. This tool reveals third-party seller identities, origin countries, and hybrid ratings directly on Amazon search results and bestseller pages.

## 🚀 Key Features

* **Hybrid Ratings**: Displays both Product Ratings and Seller Feedback percentages (e.g., `4.1 / 87%`) at a glance.
* **Auto-CSV Collection**: Automatically gathers data for every product you scroll past. No manual entry required.
* **Bestseller Support**: Optimized to work seamlessly on Amazon Bestseller grid layouts.
* **Instant Navigation**: Clickable ratings that scroll you directly to the product's customer reviews section.
* **Smart Caching**: Local storage integration to speed up load times and reduce network requests.
* **Multi-Domain Support**: Works across global Amazon domains (.com, .in, .uk, .de, .jp, etc.).
* **Multilingual Metadata**: Fully localized names and descriptions for major Amazon regions.

## 🛠 Installation

1.  **Install a Userscript Manager**: 
    * [Tampermonkey](https://www.tampermonkey.net/) (Recommended)
    * [Violentmonkey](https://violentmonkey.github.io/)
2.  **Install the Script**:
    * Click on the `reveal-seller.user.js` file in this repository.
    * Click the **Raw** button.
    * Your userscript manager will prompt you to install it. Click **Install**.

## 📖 How to Use

1.  **Browse Amazon**: Search for products or visit any Bestseller category.
2.  **View Insights**: Look for the small information box under product titles/prices showing the seller name and ratings.
3.  **Manage Data**:
    * Scroll down to the footer of the page to find the **⚙️ SoldBy** (Settings), **📥 CSV** (Download), and **🔄 Reset** buttons.
    * **CSV (Count)**: Click to download all collected product data in a `.csv` format for Excel or Google Sheets.
    * **Reset CSV**: Clears the current list of collected items without refreshing the page.
4.  **Settings**: Customize country highlighting, hide specific products, or manage the data cache via the settings menu.

## ⚙️ Metadata & Permissions

* **License**: MIT
* **Grant**: `GM.getValue`, `GM.setValue` (Used for persistent configuration)
* **Require**: `GM_config` (For the settings interface)

## 💬 Community & Support
Have a question or a sourcing tip to share? Join our [GitHub Discussions](https://github.com/Smart-rwl/Amazon-Reveal-Seller/discussions)!

## 🤝 Contributing

Feel free to fork this project, open issues, or submit pull requests to improve the extraction logic or add support for new Amazon layouts.

---
**Author**: [Smartrwl](https://github.com/smart-rwl)  
*Disclaimer: This tool is for educational and data research purposes. Please adhere to Amazon's Terms of Service while using automation tools.*
