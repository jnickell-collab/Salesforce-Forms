/**
 * SSG_CustomerSearch
 * Handle customer search for both Store users (Global) and Sales Reps (Filtered).
 * 'without sharing' is used to ensure Store users can see all accounts regardless of ownership.
 */
public without sharing class SSG_CustomerSearch {
  // Wrapper for Customer Search results returned to LWC
  public class SearchResult {
    @AuraEnabled
    public Integer index { get; set; }
    @AuraEnabled
    public String accountId { get; set; }
    @AuraEnabled
    public String accountName { get; set; }
    @AuraEnabled
    public String customerId { get; set; }
    @AuraEnabled
    public String contactName { get; set; }
    @AuraEnabled
    public String fullAddress { get; set; }

    public SearchResult(Integer index, Account acc, Contact con) {
      this.index = index;
      this.accountId = acc.Id;
      this.accountName = acc.Name;
      this.customerId = acc.XC_ExternalId__c;
      this.contactName = (con != null) ? con.Name : 'No Contact';

      String street = String.isNotBlank(acc.ShippingStreet)
        ? acc.ShippingStreet
        : '';
      String city = String.isNotBlank(acc.ShippingCity) ? acc.ShippingCity : '';
      String state = String.isNotBlank(acc.ShippingState)
        ? acc.ShippingState
        : '';
      String zip = String.isNotBlank(acc.ShippingPostalCode)
        ? acc.ShippingPostalCode
        : '';
      String fullAddress = (street +
        ' ' +
        city +
        ' ' +
        state +
        ' ' +
        zip)
        .trim();

      this.fullAddress = String.isNotBlank(fullAddress)
        ? fullAddress
        : 'No Shipping Address';
    }
  }

  /**
   * Returns current user's Sales Rep Id (if any) and role.
   * Logic:
   * - If the current User has an associated Account with XC_SalesRepId__c populated => role = 'REP' and repId = that value
   * - Else role = 'STORE' and repId = null
   */
  @AuraEnabled(cacheable=true)
  public static Map<String, String> getUserInfo() {
    try {
      User currentUser = [
        SELECT Account.XC_SalesRepId__c
        FROM User
        WHERE Id = :UserInfo.getUserId()
        WITH SECURITY_ENFORCED
        LIMIT 1
      ];
      if (
        currentUser != null &&
        currentUser.Account != null &&
        currentUser.Account.XC_SalesRepId__c != null
      ) {
        return new Map<String, String>{
          'role' => 'REP',
          'repId' => String.valueOf(currentUser.Account.XC_SalesRepId__c)
        };
      }
    } catch (Exception e) {
      System.debug('ERROR fetching user account rep info: ' + e.getMessage());
    }
    // Default to STORE role if no account or field not set
    return new Map<String, String>{ 'role' => 'STORE', 'repId' => null };
  }

  /**
   * Main search entry point for the LWC.
   */
  @AuraEnabled(cacheable=false) // need fresh results to reflect user context
  public static List<SearchResult> searchCustomers(String searchTerm) {
    if (String.isBlank(searchTerm) || searchTerm.trim().length() < 2) {
      return new List<SearchResult>();
    }

    try {
      // Determine current user role and rep id
      Map<String, String> info = getUserInfo();
      String role = info != null ? info.get('role') : 'STORE';
      String repId = info != null ? info.get('repId') : null;
      Boolean isStoreUser = (role == 'STORE');

      // Prepare sanitized values
      String trimmedTerm = searchTerm.trim();
      String searchPattern = '%' + String.escapeSingleQuotes(trimmedTerm) + '%';

      // Execute the query with proper scope
      List<Account> accounts = performDiscoverySOQL(
        searchPattern,
        trimmedTerm,
        repId,
        isStoreUser
      );

      // Build the results
      List<SearchResult> results = new List<SearchResult>();
      Integer rowIdx = 0;

      for (Account acc : accounts) {
        Contact con = (acc.Contacts != null && !acc.Contacts.isEmpty())
          ? acc.Contacts[0]
          : null;
        results.add(new SearchResult(rowIdx++, acc, con));
      }

      return results;
    } catch (Exception e) {
      System.debug(
        'ERROR in SSG_CustomerSearch.searchCustomers: ' + e.getMessage()
      );
      throw new AuraHandledException('Search failed: ' + e.getMessage());
    }
  }

  /**
   * Get relevant orders for a customer based on source Z and Product Division 40.
   * Filters by provided AccountId and orders by CreatedDate DESC.
   * Returns up to 50 records by default to support UI pagination; caller can trim if needed.
   */
  @AuraEnabled
  public static List<OrderWrapper> getRelevantOrders(String accountId) {
    List<OrderWrapper> orders = new List<OrderWrapper>();
    if (String.isBlank(accountId)) {
      return orders;
    }
    try {
      // Query for orders for the specified account with source Z and division 40
      List<Order> matchingOrders = [
        SELECT Id, XC_S2kOrderNumber__c, CreatedDate, TotalAmount, Status, Name
        FROM Order
        WHERE
          XC_OrderSource__c = 'Z'
          AND AccountId = :accountId
          AND Id IN (
            SELECT OrderId
            FROM OrderItem
            WHERE Product2.XC_ProductDivision__c = '40'
          )
        WITH SECURITY_ENFORCED
        ORDER BY CreatedDate DESC
        LIMIT 5
      ];

      for (Order ord : matchingOrders) {
        orders.add(
          new OrderWrapper(
            ord.Id,
            ord.CreatedDate,
            ord.TotalAmount,
            ord.Status,
            String.isBlank(ord.XC_S2kOrderNumber__c)
              ? ord.Name
              : ord.XC_S2kOrderNumber__c
          )
        );
      }
    } catch (Exception e) {
      System.debug(
        'ERROR in SSG_CustomerSearch.getRelevantOrders: ' + e.getMessage()
      );
      // Return empty list on error instead of throwing exception to prevent UI disruption
    }
    return orders;
  }

  // Wrapper for Order data returned to LWC
  public class OrderWrapper {
    @AuraEnabled
    public Id id { get; set; }
    @AuraEnabled
    public Datetime createdDate { get; set; }
    @AuraEnabled
    public Decimal totalAmount { get; set; }
    @AuraEnabled
    public String status { get; set; }
    @AuraEnabled
    public String displayNumber { get; set; } // Prefer S2k number when present; fallback to Name

    public OrderWrapper(
      Id id,
      Datetime createdDate,
      Decimal totalAmount,
      String status,
      String displayNumber
    ) {
      this.id = id;
      this.createdDate = createdDate;
      this.totalAmount = totalAmount;
      this.status = status;
      this.displayNumber = displayNumber;
    }
  }

  // Wrapper for Product data returned to LWC
  public class ProductWrapper {
    @AuraEnabled
    public String productCode { get; set; }
    @AuraEnabled
    public String description { get; set; }
    @AuraEnabled
    public Decimal unitPrice { get; set; }

    public ProductWrapper(
      String productCode,
      String description,
      Decimal unitPrice
    ) {
      this.productCode = productCode;
      this.description = description;
      this.unitPrice = unitPrice;
    }
  }

  /**
   * Fetch Account-level Sales Rep Number from Account.XC_SalesRepId__c
   * Returns Integer or null if not set or not numeric.
   */
  @AuraEnabled(cacheable=true)
  public static Integer getAccountRepNumber(Id accountId) {
    if (accountId == null)
      return null;
    try {
      Account a = [
        SELECT XC_SalesRepId__c
        FROM Account
        WHERE Id = :accountId
        WITH SECURITY_ENFORCED
        LIMIT 1
      ];
      if (a == null || a.XC_SalesRepId__c == null)
        return null;
      // XC_SalesRepId__c may be text; coerce to Integer when possible
      return Integer.valueOf(String.valueOf(a.XC_SalesRepId__c));
    } catch (QueryException qe) {
      // Account not found or no access
      return null;
    } catch (Exception e) {
      // Non-numeric value or other issue
      return null;
    }
  }

  /**
   * Get products for a specific division based on form selection.
   */
  @AuraEnabled(cacheable=true)
  public static List<ProductWrapper> getProducts(String division) {
    List<ProductWrapper> products = new List<ProductWrapper>();
    if (String.isBlank(division)) {
      return products;
    }
    try {
      List<PricebookEntry> entries = [
        SELECT Product2.ProductCode, Product2.XC_S2kDescription__c, UnitPrice
        FROM PricebookEntry
        WHERE
          XC_ExternalId__c LIKE '%|01'
          AND Product2.XC_ProductDivision__c = :division
          AND Product2.IsActive = TRUE
          AND Product2.XC_Usage__c = 'Back Bar'
        WITH SECURITY_ENFORCED
      ];

      for (PricebookEntry pe : entries) {
        products.add(
          new ProductWrapper(
            pe.Product2.ProductCode,
            pe.Product2.XC_S2kDescription__c,
            pe.UnitPrice
          )
        );
      }
    } catch (Exception e) {
      System.debug(
        'ERROR in SSG_CustomerSearch.getProducts: ' + e.getMessage()
      );
      // Return empty list on error
    }
    return products;
  }

  /**
   * Internal SOQL engine for customer search.
   */
  private static List<Account> performDiscoverySOQL(
    String searchPattern,
    String searchTerm,
    String repId,
    Boolean isStoreUser
  ) {
    String query =
      'SELECT Id, Name, XC_ExternalId__c, ShippingStreet, ShippingCity, ShippingState, ShippingPostalCode, ' +
      '(SELECT Id, Name FROM Contacts LIMIT 1) ' +
      'FROM Account ' +
      'WHERE (Name LIKE :searchPattern OR XC_ExternalId__c LIKE :searchPattern';
    if (!String.isBlank(searchTerm)) {
      query += ' OR XC_ExternalId__c = :searchTerm';
    }
    query += ') ';

    if (!isStoreUser && String.isNotBlank(repId)) {
      query += 'AND XC_SalesRepId__c = :repId ';
    }

    query += 'WITH SECURITY_ENFORCED ORDER BY LastModifiedDate DESC LIMIT 50';

    return Database.query(query);
  }
}
