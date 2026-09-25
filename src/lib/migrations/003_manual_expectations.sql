ALTER TABLE mail_imports DROP CONSTRAINT mail_imports_source_check;
ALTER TABLE mail_imports ADD CONSTRAINT mail_imports_source_check CHECK (source IN ('gmail','paste','manual'));
