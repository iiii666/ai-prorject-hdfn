PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS stores (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, price INTEGER NOT NULL CHECK(price>0));
CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, grade TEXT NOT NULL CHECK(grade IN ('일반','실버','골드','VIP')), joined_at TEXT NOT NULL, home_store_id INTEGER NOT NULL REFERENCES stores(id));
CREATE TABLE IF NOT EXISTS campaigns (id INTEGER PRIMARY KEY, name TEXT NOT NULL, channel TEXT NOT NULL CHECK(channel IN ('모바일 앱','오프라인')), start_date TEXT NOT NULL, end_date TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS campaign_targets (id INTEGER PRIMARY KEY, campaign_id INTEGER NOT NULL REFERENCES campaigns(id), customer_id INTEGER NOT NULL REFERENCES customers(id), store_id INTEGER NOT NULL REFERENCES stores(id), channel TEXT NOT NULL, targeted_at TEXT NOT NULL, UNIQUE(campaign_id,customer_id));
CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), store_id INTEGER NOT NULL REFERENCES stores(id), channel TEXT NOT NULL CHECK(channel IN ('모바일 앱','오프라인')), ordered_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('completed','cancelled')), campaign_target_id INTEGER REFERENCES campaign_targets(id));
CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), product_id INTEGER NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL CHECK(quantity>0), unit_price INTEGER NOT NULL CHECK(unit_price>0));
CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id), amount INTEGER NOT NULL CHECK(amount>=0), method TEXT NOT NULL, paid_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS app_sessions (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), store_id INTEGER NOT NULL REFERENCES stores(id), channel TEXT NOT NULL DEFAULT '모바일 앱' CHECK(channel='모바일 앱'), session_date TEXT NOT NULL, duration_seconds INTEGER NOT NULL CHECK(duration_seconds>=0), viewed_product INTEGER NOT NULL CHECK(viewed_product IN (0,1)), added_cart INTEGER NOT NULL CHECK(added_cart IN (0,1)), order_id INTEGER REFERENCES orders(id), CHECK(added_cart<=viewed_product));
CREATE TABLE IF NOT EXISTS campaign_spend (campaign_id INTEGER NOT NULL REFERENCES campaigns(id), store_id INTEGER NOT NULL REFERENCES stores(id), channel TEXT NOT NULL, date TEXT NOT NULL, planned INTEGER NOT NULL CHECK(planned>=0), spent INTEGER NOT NULL CHECK(spent>=0), PRIMARY KEY(campaign_id,store_id,date));
CREATE TABLE IF NOT EXISTS budget_daily (date TEXT NOT NULL, store_id INTEGER NOT NULL REFERENCES stores(id), channel TEXT NOT NULL, department TEXT NOT NULL, planned INTEGER NOT NULL CHECK(planned>=0), spent INTEGER NOT NULL CHECK(spent>=0), sales_target INTEGER NOT NULL CHECK(sales_target>=0), PRIMARY KEY(date,store_id,channel,department));
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS seed_info (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pipeline_runs (id INTEGER PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL, finished_at TEXT NOT NULL, processed_rows INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS asset_metadata (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, domain TEXT NOT NULL, description TEXT NOT NULL, owner TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS asset_edges (source TEXT NOT NULL REFERENCES asset_metadata(id), target TEXT NOT NULL REFERENCES asset_metadata(id), PRIMARY KEY(source,target));
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(ordered_at,store_id,channel,status);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id,ordered_at);
CREATE INDEX IF NOT EXISTS idx_orders_target ON orders(campaign_target_id);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON app_sessions(session_date,store_id,channel);
CREATE INDEX IF NOT EXISTS idx_targets_date ON campaign_targets(targeted_at,store_id,channel);
CREATE VIEW IF NOT EXISTS dw_fact_orders AS
 SELECT o.*,p.amount,p.method FROM orders o JOIN payments p ON p.order_id=o.id WHERE o.status='completed';
CREATE VIEW IF NOT EXISTS mart_sales_daily AS
 SELECT ordered_at AS date,store_id,channel,SUM(amount) AS sales,COUNT(*) AS orders,COUNT(DISTINCT customer_id) AS customers FROM dw_fact_orders GROUP BY ordered_at,store_id,channel;
CREATE VIEW IF NOT EXISTS mart_customer_ltv AS
 SELECT c.id AS customer_id,c.name,c.grade,COUNT(o.id) AS orders,COALESCE(SUM(o.amount),0) AS lifetime_value,MIN(o.ordered_at) AS first_purchase,MAX(o.ordered_at) AS last_purchase FROM customers c LEFT JOIN dw_fact_orders o ON o.customer_id=c.id GROUP BY c.id;
CREATE VIEW IF NOT EXISTS report_sales AS
 SELECT m.*,s.name AS store_name FROM mart_sales_daily m JOIN stores s ON s.id=m.store_id;
CREATE VIEW IF NOT EXISTS report_customers AS SELECT * FROM mart_customer_ltv;
PRAGMA user_version = 1;
