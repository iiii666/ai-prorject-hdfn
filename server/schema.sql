CREATE TABLE IF NOT EXISTS stores (id BIGINT PRIMARY KEY, name VARCHAR(255) NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS products (id BIGINT PRIMARY KEY, name VARCHAR(255) NOT NULL, category VARCHAR(32) NOT NULL, price BIGINT NOT NULL CHECK(price>0));
CREATE TABLE IF NOT EXISTS customers (id BIGINT PRIMARY KEY, name VARCHAR(255) NOT NULL, grade VARCHAR(12) NOT NULL CHECK(grade IN ('일반','실버','골드','VIP')), joined_at VARCHAR(10) NOT NULL, home_store_id BIGINT NOT NULL REFERENCES stores(id));
CREATE TABLE IF NOT EXISTS campaigns (id BIGINT PRIMARY KEY, name VARCHAR(255) NOT NULL, channel VARCHAR(16) NOT NULL CHECK(channel IN ('모바일 앱','오프라인')), start_date VARCHAR(10) NOT NULL, end_date VARCHAR(10) NOT NULL);
CREATE TABLE IF NOT EXISTS campaign_targets (id BIGINT PRIMARY KEY, campaign_id BIGINT NOT NULL REFERENCES campaigns(id), customer_id BIGINT NOT NULL REFERENCES customers(id), store_id BIGINT NOT NULL REFERENCES stores(id), channel VARCHAR(16) NOT NULL, targeted_at VARCHAR(10) NOT NULL, UNIQUE(campaign_id,customer_id));
CREATE INDEX IF NOT EXISTS idx_targets_date ON campaign_targets (targeted_at,store_id,channel);
CREATE TABLE IF NOT EXISTS orders (id BIGINT PRIMARY KEY, customer_id BIGINT NOT NULL REFERENCES customers(id), store_id BIGINT NOT NULL REFERENCES stores(id), channel VARCHAR(16) NOT NULL CHECK(channel IN ('모바일 앱','오프라인')), ordered_at VARCHAR(10) NOT NULL, status VARCHAR(20) NOT NULL CHECK(status IN ('completed','cancelled')), campaign_target_id BIGINT REFERENCES campaign_targets(id));
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders (ordered_at,store_id,channel,status);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders (customer_id,ordered_at);
CREATE INDEX IF NOT EXISTS idx_orders_target ON orders (campaign_target_id);
CREATE TABLE IF NOT EXISTS order_items (id BIGINT PRIMARY KEY, order_id BIGINT NOT NULL REFERENCES orders(id), product_id BIGINT NOT NULL REFERENCES products(id), quantity BIGINT NOT NULL CHECK(quantity>0), unit_price BIGINT NOT NULL CHECK(unit_price>0));
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items (order_id);
CREATE TABLE IF NOT EXISTS payments (id BIGINT PRIMARY KEY, order_id BIGINT NOT NULL UNIQUE REFERENCES orders(id), amount BIGINT NOT NULL CHECK(amount>=0), method VARCHAR(255) NOT NULL, paid_at VARCHAR(10) NOT NULL);
CREATE TABLE IF NOT EXISTS app_sessions (id BIGINT PRIMARY KEY, customer_id BIGINT NOT NULL REFERENCES customers(id), store_id BIGINT NOT NULL REFERENCES stores(id), channel VARCHAR(16) NOT NULL DEFAULT '모바일 앱' CHECK(channel='모바일 앱'), session_date VARCHAR(10) NOT NULL, duration_seconds BIGINT NOT NULL CHECK(duration_seconds>=0), viewed_product BIGINT NOT NULL CHECK(viewed_product IN (0,1)), added_cart BIGINT NOT NULL CHECK(added_cart IN (0,1)), order_id BIGINT REFERENCES orders(id), CHECK(added_cart<=viewed_product));
CREATE INDEX IF NOT EXISTS idx_sessions_date ON app_sessions (session_date,store_id,channel);
CREATE TABLE IF NOT EXISTS campaign_spend (campaign_id BIGINT NOT NULL REFERENCES campaigns(id), store_id BIGINT NOT NULL REFERENCES stores(id), channel VARCHAR(16) NOT NULL, date VARCHAR(10) NOT NULL, planned BIGINT NOT NULL CHECK(planned>=0), spent BIGINT NOT NULL CHECK(spent>=0), PRIMARY KEY(campaign_id,store_id,date));
CREATE TABLE IF NOT EXISTS budget_daily (date VARCHAR(10) NOT NULL, store_id BIGINT NOT NULL REFERENCES stores(id), channel VARCHAR(16) NOT NULL, department VARCHAR(64) NOT NULL, planned BIGINT NOT NULL CHECK(planned>=0), spent BIGINT NOT NULL CHECK(spent>=0), sales_target BIGINT NOT NULL CHECK(sales_target>=0), PRIMARY KEY(date,store_id,channel,department));
CREATE TABLE IF NOT EXISTS settings (key VARCHAR(100) PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS seed_info (id BIGINT PRIMARY KEY CHECK(id=1), version BIGINT NOT NULL, start_date VARCHAR(10) NOT NULL, end_date VARCHAR(10) NOT NULL, created_at VARCHAR(255) NOT NULL);
CREATE TABLE IF NOT EXISTS pipeline_runs (id BIGINT PRIMARY KEY, name VARCHAR(255) NOT NULL, status VARCHAR(20) NOT NULL, finished_at VARCHAR(255) NOT NULL, processed_rows BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS asset_metadata (id VARCHAR(255) PRIMARY KEY, name VARCHAR(255) NOT NULL, type VARCHAR(255) NOT NULL, domain VARCHAR(255) NOT NULL, description VARCHAR(255) NOT NULL, owner VARCHAR(255) NOT NULL);
CREATE TABLE IF NOT EXISTS asset_edges (source VARCHAR(255) NOT NULL REFERENCES asset_metadata(id), target VARCHAR(255) NOT NULL REFERENCES asset_metadata(id), PRIMARY KEY(source,target));
CREATE OR REPLACE VIEW dw_fact_orders AS
 SELECT o.*,p.amount,p.method FROM orders o JOIN payments p ON p.order_id=o.id WHERE o.status='completed';
CREATE OR REPLACE VIEW mart_sales_daily AS
 SELECT ordered_at AS date,store_id,channel,SUM(amount) AS sales,COUNT(*) AS orders,COUNT(DISTINCT customer_id) AS customers FROM dw_fact_orders GROUP BY ordered_at,store_id,channel;
CREATE OR REPLACE VIEW mart_customer_ltv AS
 SELECT c.id AS customer_id,c.name,c.grade,COUNT(o.id) AS orders,COALESCE(SUM(o.amount),0) AS lifetime_value,MIN(o.ordered_at) AS first_purchase,MAX(o.ordered_at) AS last_purchase FROM customers c LEFT JOIN dw_fact_orders o ON o.customer_id=c.id GROUP BY c.id;
CREATE OR REPLACE VIEW report_sales AS
 SELECT m.*,s.name AS store_name FROM mart_sales_daily m JOIN stores s ON s.id=m.store_id;
CREATE OR REPLACE VIEW report_customers AS SELECT * FROM mart_customer_ltv;
