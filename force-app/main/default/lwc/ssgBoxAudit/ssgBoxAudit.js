import { LightningElement } from 'lwc';
import { getBarcodeScanner } from 'lightning/mobileCapabilities';
import getBoxAudit from '@salesforce/apex/SsgBoxAudit.getBoxAudit';

export default class SsgBoxAudit extends LightningElement {

    barcodeScanner;

    connectedCallback() {
        this.barcodeScanner = getBarcodeScanner();
        window.addEventListener('scroll', this.handleScroll);
    }

    disconnectedCallback() {
        window.removeEventListener('scroll', this.handleScroll);
    }

    handleScroll = () => {
        // Show button if scrolled down 300px or more
        this.showBackToTop = window.scrollY > 300;
        // Keep barcode input focused to make scans seamless while scrolling
        this.focusBarcodeInput();
    };

    beginScanning() {
        if (!this.barcodeScanner || !this.barcodeScanner.isAvailable()) {
            console.log('BarcodeScanner unavailable. Non-mobile device?');
            return;
        }

        const scanningOptions = {
            barcodeTypes: [
                this.barcodeScanner.barcodeTypes.CODE_128,
                this.barcodeScanner.barcodeTypes.CODE_39,
                this.barcodeScanner.barcodeTypes.CODE_93,
                this.barcodeScanner.barcodeTypes.DATA_MATRIX,
                this.barcodeScanner.barcodeTypes.EAN_13,
                this.barcodeScanner.barcodeTypes.EAN_8,
                this.barcodeScanner.barcodeTypes.ITF,
                this.barcodeScanner.barcodeTypes.PDF_417,
                this.barcodeScanner.barcodeTypes.QR,
                this.barcodeScanner.barcodeTypes.UPC_A,
                this.barcodeScanner.barcodeTypes.UPC_E
            ],
            scannerSize: 'FULLSCREEN',
            cameraFacing: 'BACK',
            showSuccessCheckMark: true,
            vibrateOnSuccess: true,
            enableScanLine: true,
            enableActionButtons: true,
            enableBulkScan: false,
            enableMultiScan: false
        };

        this.clearResults();

        this.barcodeScanner
            .scan(scanningOptions)
            .then((results) => this.processScannerResults(results))
            .catch((error) => this.processScannerError(error))
            .finally(() => this.barcodeScanner.dismiss());
    }

    async processScannerResults(barcodes) {
        if (!barcodes || !barcodes.length) {
            return;
        }
        this.barcode = barcodes[0]?.value || '';
        await this.handleSearch();
    }

    processScannerError(error) {
        if (error && error.code !== 'USER_DISMISSED') {
            console.error('BarcodeScanner error', error);
        }
    }

    scrollToTop() {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    barcode = '';
    pickTicket = null;
    itemDetails = [];
    s2kSummary = null;
    itemsInBox = 0;
    showBackToTop = false;

    // No longer using datatable columns; mobile card layout

    handleBarcodeChange(event) {
        // Auto-clear results and update barcode
        this.barcode = event.target.value;
        this.clearResults();
    }

    handleBarcodeKeyup(event) {
        // If Enter is pressed, trigger search and clear barcode
        if (event.key === 'Enter') {
            this.handleSearch();
            this.barcode = '';
            this.clearResults();
            this.focusBarcodeInput();
        } else {
            // Auto-clear results on any input
            this.clearResults();
        }
    }

    async handleSearch() {
        if (!this.barcode) return;
        try {
            const result = await getBoxAudit({ barcode: this.barcode });
            // Map API fields to UI fields (API returns PascalCase/UPPERCASE, UI expects camelCase)
            this.itemDetails = (result || []).map((item, idx) => {
                // Always parse as numbers for logic
                const qtyToPick = Number(item.QtyToPick) || 0;
                const qtyPicked = Number(item.QtyPicked) || 0;
                const hlQtyPicked = Number(item.HIqtyPicked) || 0;
                const holdsAvailableQty = Number(item.hpavailableqty) || 0;
                let colorClass = '';
                // Highlight yellow if QtyToPick ≠ QtyPicked and hpavailableqty > 0 and HIqtyPicked ≠ QtyToPick
                if (
                    qtyToPick !== qtyPicked &&
                    holdsAvailableQty > 0 &&
                    hlQtyPicked !== qtyToPick
                ) {
                    colorClass = 'ssg-box-yellow';
                }
                // Highlight red if QtyToPick ≠ QtyPicked and hpavailableqty = 0 and HIqtyPicked ≠ QtyToPick
                else if (
                    qtyToPick !== qtyPicked &&
                    holdsAvailableQty === 0 &&
                    hlQtyPicked !== qtyToPick
                ) {
                    colorClass = 'ssg-box-red';
                }
                const baseClass = 'ssg-mobile-section';
                return {
                    id: idx + '',
                    pickTicketId: item.PickTicketId,
                    sku: (item.SKU || '').trim(),
                    skuDescription: item.SkuDesc,
                    upc: item.UPC,
                    qtyToPick: qtyToPick,
                    qtyPicked: qtyPicked,
                    hlQtyPicked: hlQtyPicked,
                    holdsAvailableQty: holdsAvailableQty,
                    whsLocation: item.WhseLocation,
                    s2kOnHand: item.ONHAND,
                    s2kCommitted: item.COMMITED,
                    s2kAvailable: item.AVAILABLE,
                    colorClass,
                    cardClass: [baseClass, colorClass].filter(Boolean).join(' ')
                };
            });
        } catch (e) {
            // Optionally show error to user
            this.itemDetails = [];
            // eslint-disable-next-line no-console
            console.error('Box Audit API error', e);
        }
        // Refocus barcode input for next scan
        this.focusBarcodeInput();
    }

    handleClear() {
        this.barcode = '';
        this.clearResults();
        this.focusBarcodeInput();
    }

    clearResults() {
        this.pickTicket = null;
        this.itemDetails = [];
        this.s2kSummary = null;
        this.itemsInBox = 0;
    }

    focusBarcodeInput() {
        // Focus the barcode input field
        const input = this.template.querySelector('[data-barcode-input]');
        if (input) {
            input.focus();
        }
    }

    renderedCallback() {
        // Always focus barcode input on render if barcode is blank
        if (!this.barcode) {
            this.focusBarcodeInput();
        }
    }
}