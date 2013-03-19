VERSION=0.009
LIB = /usr/local/lib/openjscad/

all::
	@echo "make install deinstall tests" 


install::
	sudo npm -g install openscad-openjscad-translator sylvester underscore requirejs
	sudo scp openjscad /usr/local/bin/
	sudo mkdir -p ${LIB}
	sudo scp *.js ${LIB}
                                
deinstall::
	sudo rm -f ${LIB}/*.js 

tests::
	openjscad examples/example000.jscad
	openjscad examples/example001.jscad
	openjscad examples/example001.scad -o examples/example001-fromSCAD.stl
	openjscad examples/example001.scad -o examples/example001-fromSCAD.jscad
                                        
# --- developers only below

push::
	git remote set-url origin git@github.com:Spiritdude/OpenJSCAD.org.git
	git push -u origin master

pull::
	git remote set-url origin git@github.com:Spiritdude/OpenJSCAD.org.git
	git pull -u origin master

dist::	
	cd ..; tar cfz Backup/openjscad.org-${VERSION}.tar.gz "--exclude=*.git/*" OpenJSCAD.org/

backup::	
	scp ../Backup/openjscad.org-${VERSION}.tar.gz the-labs.com:Backup/

edit::
	dee4 index.html Makefile README.md *.css *.js openjscad

live::
	# -- do not enable --delete is it will destroy stats folder
	rsync -av --exclude=.git ./ the-labs.com:Sites/openjscad.org/ 
