/**
 * FormDivisionLookup
 *
 * Central lookup for form names, division IDs, and sub-form metadata.
 * Both LWCs (rewardRedemptionForm, redemptionItemAdmin) and server-side
 * logic can call these methods to resolve a form name to its division
 * and determine sub-form relationships.
 */
public with sharing class FormDivisionLookup {

    public class FormEntry {
        @AuraEnabled public String formName   { get; set; }
        @AuraEnabled public Integer divisionId { get; set; }
        @AuraEnabled public Boolean isSubForm  { get; set; }
        @AuraEnabled public String parentForm  { get; set; }
        @AuraEnabled public String promoTier   { get; set; }

        public FormEntry(String formName, Integer divisionId, Boolean isSubForm, String parentForm, String promoTier) {
            this.formName   = formName;
            this.divisionId = divisionId;
            this.isSubForm  = isSubForm;
            this.parentForm = parentForm;
            this.promoTier  = promoTier;
        }
    }

    // Master registry — single source of truth
    private static List<FormEntry> buildRegistry() {
        return new List<FormEntry>{
            new FormEntry('18.21 Man Made',          10, false, null,              null),
            new FormEntry('Alfaparf',                 8, false, null,              null),
            new FormEntry('AlterEgo',                56, false, null,              null),
            new FormEntry('ColorProof',              11, false, null,              null),
            new FormEntry('Eleven',                  28, false, null,              null),
            new FormEntry('J Beverly Hills',         46, false, null,              null),
            new FormEntry('J Beverly Hills Concept', 46, true,  'J Beverly Hills', null),
            new FormEntry('Keratherapy',             17, false, null,              null),
            new FormEntry('Living Proof',            41, false, null,              null),
            new FormEntry('Milbon',                  40, false, null,              null),
            new FormEntry('Milbon Gold',             40, true,  'Milbon',          'Gold'),
            new FormEntry('Milbon Platinum',         40, true,  'Milbon',          'Platinum'),
            new FormEntry('Milbon Diamond',          40, true,  'Milbon',          'Diamond'),
            new FormEntry('Neuma',                   39, false, null,              null),
            new FormEntry('Oligo',                   36, false, null,              null),
            new FormEntry('Reuzel',                  38, false, null,              null),
            new FormEntry('Shibui',                  52, false, null,              null),
            new FormEntry('U-Smooth',                 9, false, null,              null),
            new FormEntry('Unite',                   30, false, null,              null),
            new FormEntry('Zenagen',                 27, false, null,              null)
        };
    }

    /**
     * Return every form entry (parent + sub-forms).
     * Cacheable so the LWC can wire it once.
     */
    @AuraEnabled(cacheable=true)
    public static List<FormEntry> getAllForms() {
        return buildRegistry();
    }

    /**
     * Resolve a single form name to its division ID.
     * Returns null when the name is not recognised.
     */
    @AuraEnabled(cacheable=true)
    public static Integer getDivisionByFormName(String formName) {
        if (String.isBlank(formName)) {
            return null;
        }
        String normalised = formName.trim();
        for (FormEntry entry : buildRegistry()) {
            if (entry.formName.equalsIgnoreCase(normalised)) {
                return entry.divisionId;
            }
        }
        return null;
    }

    /**
     * Resolve a single form name to its full entry.
     * Returns null when the name is not recognised.
     */
    @AuraEnabled(cacheable=true)
    public static FormEntry getFormEntry(String formName) {
        if (String.isBlank(formName)) {
            return null;
        }
        String normalised = formName.trim();
        for (FormEntry entry : buildRegistry()) {
            if (entry.formName.equalsIgnoreCase(normalised)) {
                return entry;
            }
        }
        return null;
    }
}
