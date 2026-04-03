/**
 * RedemptionOrderService
 *
 * Service to persist redemption orders from LWC/Flow into:
 * - RedemptionFormHeader__c
 * - RedemptionFormDetails__c
 *
 * Patterns:
 * - with sharing
 * - Bulk-safe (accepts multiple orders)
 * - USER_MODE DML
 * - Return Early, validation, and structured results
 * - No SOQL/DML in loops
 *
 * PO format per requirements:
 *   "MB REBATE yyyyMMddHHmmss"
 * Stored on both Header.PONumber__c and Details.PONumber__c
 */
public with sharing class RedemptionOrderService {
  // DTOs exposed to LWC
  public class OrderLine {
    @AuraEnabled
    public String itemId { get; set; }
    @AuraEnabled
    public Integer quantity { get; set; }
    @AuraEnabled
    public Decimal unitPrice { get; set; }
    @AuraEnabled
    public String message { get; set; }
    @AuraEnabled
    public String shipWithNext { get; set; } // Text(1) e.g., 'Y' or 'N' or null
    @AuraEnabled
    public Boolean isSpecial { get; set; } // true for Diamond/Platinum special tab items
  }
  public class OrderRequest {
    @AuraEnabled
    public String customerId { get; set; }
    @AuraEnabled
    public Integer repNumber { get; set; }
    @AuraEnabled
    public String formName { get; set; } // Expect 'Milbon' per use case
    @AuraEnabled
    public List<OrderLine> lines { get; set; }
    @AuraEnabled
    public String currencyIsoCode { get; set; } // optional (multi-currency orgs)
    @AuraEnabled
    public String formStatus { get; set; } // 'SAVED' or 'COMPLETE' (optional; default COMPLETE)
    @AuraEnabled
    public String customerType { get; set; } // 'NONE', 'DIAMOND', 'PLATINUM'
  }
  public class LineResult {
    @AuraEnabled
    public Id detailId { get; set; }
    @AuraEnabled
    public String itemId { get; set; }
    @AuraEnabled
    public Integer quantity { get; set; }
    @AuraEnabled
    public Decimal unitPrice { get; set; }
  }
  public class OrderResult {
    @AuraEnabled
    public Boolean success { get; set; }
    @AuraEnabled
    public String message { get; set; }
    @AuraEnabled
    public Id headerId { get; set; }
    @AuraEnabled
    public String poNumber { get; set; }
    @AuraEnabled
    public Decimal orderTotal { get; set; }
    @AuraEnabled
    public List<LineResult> lineResults { get; set; }
  }

  // DTOs for loading existing header + details
  public class LoadedHeader {
    @AuraEnabled
    public Id id { get; set; }
    @AuraEnabled
    public String name { get; set; }
    @AuraEnabled
    public String customerId { get; set; }
    @AuraEnabled
    public Integer repNumber { get; set; }
    @AuraEnabled
    public String formName { get; set; }
    @AuraEnabled
    public String formStatus { get; set; }
    @AuraEnabled
    public String poNumber { get; set; }
    @AuraEnabled
    public Decimal orderTotal { get; set; }
    @AuraEnabled
    public Datetime createdDate { get; set; }
    @AuraEnabled
    public Datetime lastModifiedDate { get; set; }
    @AuraEnabled
    public String currencyIsoCode { get; set; }
    @AuraEnabled
    public String promoTier { get; set; }
  }
  public class LoadedDetail {
    @AuraEnabled
    public Id id { get; set; }
    @AuraEnabled
    public String itemId { get; set; }
    @AuraEnabled
    public Integer quantity { get; set; }
    @AuraEnabled
    public Decimal unitPrice { get; set; }
    @AuraEnabled
    public String message { get; set; }
    @AuraEnabled
    public String shipWithNext { get; set; }
    @AuraEnabled
    public Boolean isSpecial { get; set; }
  }
  public class LoadFormResult {
    @AuraEnabled
    public Boolean success { get; set; }
    @AuraEnabled
    public String message { get; set; }
    @AuraEnabled
    public LoadedHeader header { get; set; }
    @AuraEnabled
    public List<LoadedDetail> details { get; set; }
  }

  @AuraEnabled
  public static List<OrderResult> submitOrders(List<OrderRequest> requests) {
    // Handle null/empty inputs
    if (requests == null || requests.isEmpty()) {
      return new List<OrderResult>();
    }

    // Prepare outputs and records to insert
    List<OrderResult> results = new List<OrderResult>();
    List<RedemptionFormHeader__c> headersToInsert = new List<RedemptionFormHeader__c>();
    List<List<RedemptionFormDetails__c>> allDetailsPerOrder = new List<List<RedemptionFormDetails__c>>();

    // First pass: validate and build sObjects (no DML yet)
    for (OrderRequest req : requests) {
      OrderResult res = new OrderResult();
      res.success = false;
      res.lineResults = new List<LineResult>();

      if (req == null) {
        res.message = 'Missing order request.';
        results.add(res);
        continue;
      }
      // Comprehensive validation for customerId to handle edge cases
      Boolean isValidCustomerId =
        req.customerId != null &&
        req.customerId.length() > 0 &&
        req.customerId.trim() != '';
      if (!isValidCustomerId) {
        res.message = 'Missing Customer ID.';
        results.add(res);
        continue;
      }
      if (req.repNumber == null) {
        res.message = 'Missing Rep Number.';
        results.add(res);
        continue;
      }
      if (String.isBlank(req.formName)) {
        res.message = 'Missing Form Name.';
        results.add(res);
        continue;
      }
      // Scope to Milbon orders per requirement
      if (!'Milbon'.equalsIgnoreCase(req.formName)) {
        res.message = 'Unsupported form: ' + req.formName;
        results.add(res);
        continue;
      }
      if (req.lines == null || req.lines.isEmpty()) {
        res.message = 'At least one line is required.';
        results.add(res);
        continue;
      }

      // Build detail lines; compute total
      Decimal computedTotal = 0;
      List<RedemptionFormDetails__c> details = new List<RedemptionFormDetails__c>();
      for (OrderLine l : req.lines) {
        if (l == null)
          continue;
        if (String.isBlank(l.itemId))
          continue;
        if (l.quantity == null || l.quantity <= 0)
          continue;
        if (l.unitPrice == null || l.unitPrice < 0)
          continue;

        Decimal lineSubtotal = (l.unitPrice) * l.quantity;
        computedTotal += lineSubtotal;

        RedemptionFormDetails__c det = new RedemptionFormDetails__c();
        det.Name = l.itemId + ' x' + String.valueOf(l.quantity);
        det.CustomerID__c = req.customerId;
        det.ItemID__c = l.itemId;
        det.Quantity__c = l.quantity;
        det.ItemPrice__c = l.unitPrice;
        det.Message__c = (l.isSpecial == true) ? 'SPECIAL' : l.message;
        det.ShipWithNext__c = l.shipWithNext;
        // PONumber__c will be set after we generate PO per order
        details.add(det);
      }
      if (details.isEmpty()) {
        res.message = 'All lines invalid. Ensure positive quantity and non-negative price.';
        results.add(res);
        continue;
      }

      // Create header record; set values except PONumber (generated once per order)
      RedemptionFormHeader__c hdr = new RedemptionFormHeader__c();
      hdr.Name = 'Milbon Redemption ' + formatNowForName();
      hdr.CustomerID__c = req.customerId;
      hdr.RepNumber__c = req.repNumber;
      hdr.FormName__c = 'Milbon';
      hdr.OrderTotal__c = computedTotal;
      // Set status: default COMPLETE if not provided
      String desiredStatus = String.isBlank(req.formStatus)
        ? 'COMPLETE'
        : req.formStatus.trim().toUpperCase();
      hdr.FormStatus__c = desiredStatus;
      // Store promo tier (Diamond/Platinum) if provided
      String promoTier = String.isBlank(req.customerType) ? 'NONE' : req.customerType.trim().toUpperCase();
      if (promoTier != 'NONE') {
        hdr.SSG_PromoTier__c = promoTier;
      }
      if (
        Schema.sObjectType.RedemptionFormHeader__c.fields.CurrencyIsoCode.isCreateable() &&
        req.currencyIsoCode != null
      ) {
        hdr.CurrencyIsoCode = req.currencyIsoCode;
      }

      headersToInsert.add(hdr);
      allDetailsPerOrder.add(details);

      // Prepopulate partial result (we will finish after DML)
      res.orderTotal = computedTotal;
      results.add(res);
    }

    if (headersToInsert.isEmpty()) {
      return results; // nothing to insert; likely all validation errors
    }

    // Generate PO numbers unique per order: "MB REBATE yyyyMMddHHmmss"
    // Basic check against duplicates that might exist already (best-effort)
    // We generate per order, then set on header and its details.
    List<String> generatedPOs = new List<String>();
    for (Integer i = 0; i < headersToInsert.size(); i++) {
      String po = generatePoNumberCore();
      // Ensure uniqueness within this batch (rare collision)
      while (generatedPOs.contains(po)) {
        po = generatePoNumberCore();
      }
      generatedPOs.add(po);
      headersToInsert[i].PONumber__c = po;

      // Set the same PO on each detail for this order
      for (RedemptionFormDetails__c d : allDetailsPerOrder[i]) {
        d.PONumber__c = po;
      }
    }

    // Perform DML in USER_MODE
    Database.SaveResult[] hdrSrs = Database.insert(
      headersToInsert,
      false,
      AccessLevel.USER_MODE
    );

    // Flatten details and insert
    List<RedemptionFormDetails__c> detailsFlat = new List<RedemptionFormDetails__c>();
    Map<Integer, Integer> orderIndexToStart = new Map<Integer, Integer>();
    Integer orderIdx = 0;
    for (List<RedemptionFormDetails__c> perOrder : allDetailsPerOrder) {
      orderIndexToStart.put(orderIdx, detailsFlat.size());
      detailsFlat.addAll(perOrder);
      orderIdx++;
    }
    Database.SaveResult[] detSrs = detailsFlat.isEmpty()
      ? new List<Database.SaveResult>()
      : Database.insert(detailsFlat, false, AccessLevel.USER_MODE);

    // Build final results
    Integer hdrIdx = 0;
    for (Integer rIdx = 0; rIdx < results.size(); rIdx++) {
      OrderResult r = results[rIdx];

      // If this result corresponds to a header we tried to insert
      if (hdrIdx < hdrSrs.size()) {
        Database.SaveResult hsr = hdrSrs[hdrIdx];
        if (!hsr.isSuccess()) {
          r.success = false;
          r.message = firstError(hsr);
        } else {
          r.success = true;
          r.headerId = hsr.getId();
          r.poNumber = generatedPOs[hdrIdx];

          // Attach line results for this order
          Integer start = orderIndexToStart.get(hdrIdx);
          Integer len = allDetailsPerOrder[hdrIdx].size();
          List<LineResult> lr = new List<LineResult>();
          for (Integer i = 0; i < len; i++) {
            Database.SaveResult dsr = detSrs[start + i];
            RedemptionFormDetails__c src = detailsFlat[start + i];

            LineResult one = new LineResult();
            one.itemId = src.ItemID__c;
            one.quantity = src.Quantity__c == null
              ? null
              : src.Quantity__c.intValue();
            one.unitPrice = src.ItemPrice__c;
            if (dsr != null && dsr.isSuccess()) {
              one.detailId = dsr.getId();
            }
            lr.add(one);
          }
          r.lineResults = lr;
        }
        hdrIdx++;
      } else {
        // This result failed validation earlier (no header attempted)
        // Keep its existing message/success=false
      }
    }

    return results;
  }

  // Core PO generator: "MB REBATE yyyyMMddHHmmss"
  private static String generatePoNumberCore() {
    Datetime now = Datetime.now();
    String ts = now.format('yyyyMMddHHmmss', UserInfo.getLocale());
    return 'MB REBATE ' + ts;
  }

  // For Header.Name readability
  private static String formatNowForName() {
    Datetime now = Datetime.now();
    return now.format('yyyyMMdd-HHmmss', UserInfo.getLocale());
  }

  // Utility to extract the first error message
  private static String firstError(Database.SaveResult sr) {
    if (sr == null)
      return 'Unknown error';
    Database.Error[] errs = sr.getErrors();
    if (errs == null || errs.isEmpty())
      return 'Unknown error';
    return errs[0].getMessage();
  }

  /**
   * Fetch recent RedemptionFormHeaders for a given CustomerID (XC_ExternalId__c).
   * Returns the most recent 5 forms ordered by CreatedDate DESC.
   */
  @AuraEnabled(cacheable=true)
  public static List<RedemptionFormHeader__c> getRecentRedemptionForms(
    String customerId
  ) {
    if (customerId == null || customerId == '')
      return new List<RedemptionFormHeader__c>();

    try {
      return [
        SELECT Id, PONumber__c, OrderTotal__c, CreatedDate, FormStatus__c
        FROM RedemptionFormHeader__c
        WHERE CustomerID__c = :customerId
        ORDER BY CreatedDate DESC
        LIMIT 5
      ];
    } catch (Exception e) {
      System.debug(
        'ERROR in RedemptionOrderService.getRecentRedemptionForms: ' +
        e.getMessage()
      );
      return new List<RedemptionFormHeader__c>();
    }
  }

  /**
   * Fetch saved (draft) forms for a given CustomerID or RepNumber, with an optional form name.
   * Only returns headers with FormStatus__c = 'SAVED'.
   */
  @AuraEnabled(cacheable=true)
  public static List<RedemptionFormHeader__c> getSavedForms(
    String customerId,
    String formName,
    Integer repNumber
  ) {
    if (String.isBlank(customerId) && repNumber == null) {
      return new List<RedemptionFormHeader__c>();
    }
    String normalizedForm = String.isBlank(formName) ? null : formName.trim();
    try {
      List<String> clauses = new List<String>{ 'FormStatus__c = \'SAVED\'' };
      if (!String.isBlank(customerId)) {
        clauses.add('CustomerID__c = :customerId');
      }
      if (repNumber != null) {
        clauses.add('RepNumber__c = :repNumber');
      }
      if (normalizedForm != null) {
        clauses.add('FormName__c = :normalizedForm');
      }
      String soql =
        'SELECT Id, Name, PONumber__c, OrderTotal__c, CreatedDate, LastModifiedDate, FormName__c, FormStatus__c ' +
        'FROM RedemptionFormHeader__c ' +
        'WHERE ' +
        String.join(clauses, ' AND ') +
        ' ORDER BY LastModifiedDate DESC LIMIT 50';
      return (List<RedemptionFormHeader__c>) Database.query(soql);
    } catch (Exception e) {
      System.debug(
        'ERROR in RedemptionOrderService.getSavedForms: ' + e.getMessage()
      );
      return new List<RedemptionFormHeader__c>();
    }
  }

  /**
   * Load a specific redemption form (header + details) for editing/resume.
   * Returns header info and its details mapped for LWC.
   */
  @AuraEnabled(cacheable=true)
  public static LoadFormResult loadFormWithDetails(Id headerId) {
    LoadFormResult out = new LoadFormResult();
    out.success = false;
    out.details = new List<LoadedDetail>();

    if (headerId == null) {
      out.message = 'Missing header Id.';
      return out;
    }
    try {
      RedemptionFormHeader__c h = [
        SELECT
          Id,
          Name,
          CustomerID__c,
          RepNumber__c,
          FormName__c,
          FormStatus__c,
          PONumber__c,
          OrderTotal__c,
          CreatedDate,
          LastModifiedDate,
          CurrencyIsoCode,
          SSG_PromoTier__c
        FROM RedemptionFormHeader__c
        WHERE Id = :headerId
        LIMIT 1
      ];

      List<RedemptionFormDetails__c> dets = [
        SELECT
          Id,
          ItemID__c,
          Quantity__c,
          ItemPrice__c,
          Message__c,
          ShipWithNext__c
        FROM RedemptionFormDetails__c
        WHERE PONumber__c = :h.PONumber__c
        ORDER BY CreatedDate ASC
      ];

      LoadedHeader lh = new LoadedHeader();
      lh.id = h.Id;
      lh.name = h.Name;
      lh.customerId = h.CustomerID__c;
      lh.repNumber = h.RepNumber__c == null ? null : h.RepNumber__c.intValue();
      lh.formName = h.FormName__c;
      lh.formStatus = h.FormStatus__c;
      lh.poNumber = h.PONumber__c;
      lh.orderTotal = h.OrderTotal__c;
      lh.createdDate = h.CreatedDate;
      lh.lastModifiedDate = h.LastModifiedDate;
      lh.currencyIsoCode = (Schema.sObjectType.RedemptionFormHeader__c.fields.CurrencyIsoCode.isAccessible())
        ? String.valueOf(h.CurrencyIsoCode)
        : null;
      lh.promoTier = h.SSG_PromoTier__c;

      for (RedemptionFormDetails__c d : dets) {
        LoadedDetail ld = new LoadedDetail();
        ld.id = d.Id;
        ld.itemId = d.ItemID__c;
        ld.quantity = d.Quantity__c == null ? null : d.Quantity__c.intValue();
        ld.unitPrice = d.ItemPrice__c;
        ld.message = d.Message__c;
        ld.shipWithNext = d.ShipWithNext__c;
        ld.isSpecial = (d.Message__c == 'SPECIAL');
        out.details.add(ld);
      }

      out.header = lh;
      out.success = true;
      return out;
    } catch (Exception e) {
      out.message = 'Unable to load form: ' + e.getMessage();
      return out;
    }
  }
}
