/**
 * Test class for RedemptionOrderService to isolate the customerId issue
 */
@isTest
public class TestRedemptionOrderService {
    
    @isTest
    static void testCustomerIdDeserialization() {
        // Create a test OrderRequest with customerId
        RedemptionOrderService.OrderRequest request = new RedemptionOrderService.OrderRequest();
        request.customerId = 'AAD7709';
        request.repNumber = 12345;
        request.formName = 'Milbon';
        
        // Create a test OrderLine
        RedemptionOrderService.OrderLine line = new RedemptionOrderService.OrderLine();
        line.itemId = 'TEST001';
        line.quantity = 1;
        line.unitPrice = 100.00;
        line.message = null;
        line.shipWithNext = null;
        
        request.lines = new List<RedemptionOrderService.OrderLine>{line};
        
        // Create a list of requests
        List<RedemptionOrderService.OrderRequest> requests = new List<RedemptionOrderService.OrderRequest>{request};
        
        // Test that the request is properly constructed
        System.assertEquals('AAD7709', request.customerId, 'customerId should be AAD7709');
        System.assertEquals(12345, request.repNumber, 'repNumber should be 12345');
        System.assertEquals('Milbon', request.formName, 'formName should be Milbon');
        System.assertEquals(1, request.lines.size(), 'Should have 1 line');
        
        // Test the submitOrders method with debug output
        Test.startTest();
        List<RedemptionOrderService.OrderResult> results = RedemptionOrderService.submitOrders(requests);
        Test.stopTest();
        
        // Verify we got a result
        System.assertNotEquals(null, results, 'Results should not be null');
        System.assertEquals(1, results.size(), 'Should have 1 result');
        
        RedemptionOrderService.OrderResult result = results[0];
        System.assertEquals(true, result.success, 'Order should be successful');
        System.assertNotEquals(null, result.headerId, 'Header ID should not be null');
        System.assertNotEquals(null, result.poNumber, 'PO Number should not be null');
    }
    
    @isTest
    static void testCustomerIdNullHandling() {
        // Test with null customerId
        RedemptionOrderService.OrderRequest request = new RedemptionOrderService.OrderRequest();
        request.customerId = null;
        request.repNumber = 12345;
        request.formName = 'Milbon';
        
        // Create a test OrderLine
        RedemptionOrderService.OrderLine line = new RedemptionOrderService.OrderLine();
        line.itemId = 'TEST001';
        line.quantity = 1;
        line.unitPrice = 100.00;
        line.message = null;
        line.shipWithNext = null;
        
        request.lines = new List<RedemptionOrderService.OrderLine>{line};
        
        List<RedemptionOrderService.OrderRequest> requests = new List<RedemptionOrderService.OrderRequest>{request};
        
        Test.startTest();
        List<RedemptionOrderService.OrderResult> results = RedemptionOrderService.submitOrders(requests);
        Test.stopTest();
        
        // Should fail with "Missing Customer ID" error
        System.assertNotEquals(null, results, 'Results should not be null');
        System.assertEquals(1, results.size(), 'Should have 1 result');
        
        RedemptionOrderService.OrderResult result = results[0];
        System.assertEquals(false, result.success, 'Order should fail');
        System.assert(result.message.contains('Missing Customer ID'), 'Should contain Missing Customer ID error');
    }
}