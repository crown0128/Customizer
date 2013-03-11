VERSION=0.004

all::
	@echo "make install deinstall" 


install::
	sudo scp openjscad /usr/local/bin/
	sudo mkdir -p ${LIB}
	sudo scp *.js ${LIB}
                                
deinstall::
	sudo rm -f ${LIB}/*.js 
                                        
# --- developers only below

github::
	git remote set-url origin git@github.com:Spiritdude/OpenJSCAD.org.git
	git push -u origin master

dist::	
	cd ..; tar cfz Backup/openjscad.org-${VERSION}.tar.gz "--exclude=*.git/*" OpenJSCAD.org/

backup::	
	scp ../Backup/openjscad.org-${VERSION}.tar.gz the-labs.com:Backup/

edit::
	dee4 index.html Makefile README.md *.css *.js
