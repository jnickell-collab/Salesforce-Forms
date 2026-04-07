# Salesforce DX Project: Next Steps

Now that you’ve created a Salesforce DX project, what’s next? Here are some documentation resources to get you started.

## How Do You Plan to Deploy Your Changes?

Do you want to deploy a set of changes, or create a self-contained application? Choose a [development model](https://developer.salesforce.com/tools/vscode/en/user-guide/development-models).

## Configure Your Salesforce DX Project

The `sfdx-project.json` file contains useful configuration information for your project. See [Salesforce DX Project Configuration](https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_ws_config.htm) in the _Salesforce DX Developer Guide_ for details about this file.

## Read All About It

- [Salesforce Extensions Documentation](https://developer.salesforce.com/tools/vscode/)
- [Salesforce CLI Setup Guide](https://developer.salesforce.com/docs/atlas.en-us.sfdx_setup.meta/sfdx_setup/sfdx_setup_intro.htm)
- [Salesforce DX Developer Guide](https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_intro.htm)
- [Salesforce CLI Command Reference](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference.htm)

## LWC Master Theme

This project now has a shared LWC theme bundle at `force-app/main/default/lwc/ssgMasterTheme/`.

To apply the theme in any component stylesheet, add this as the first line of the component CSS file:

```css
@import 'c/ssgMasterTheme';
```

Use the shared tokens instead of hard-coded values where possible, for example:

```css
:host {
	font-family: var(--theme-font-family);
}

.panel {
	background: var(--surface-color);
	border: 1px solid var(--border-color);
	border-radius: var(--radius-md);
	color: var(--text-primary);
	box-shadow: var(--shadow-sm);
}
```

If you want to update the visual system across every themed LWC, change the variables in `ssgMasterTheme.css` instead of editing individual components.

The theme also defines shared SLDS styling hooks so common base components inherit the same look automatically. That includes `lightning-button`, `lightning-input`, `lightning-textarea`, `lightning-combobox`, and `lightning-card`. In most new LWCs, importing the theme should be enough to get the default button, field, and card styling without writing local overrides.
